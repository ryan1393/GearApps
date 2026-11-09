// Truck Log database migrations.
//
//   node tools/truck-log/migrate.mjs            apply pending migrations (server container start)
//   node tools/truck-log/migrate.mjs --status   list applied and pending migrations, change nothing
//
// Migrations live in database/truck-log/migrations as NNNN_name.sql and run in
// order, each inside its own transaction, under a session advisory lock so two
// servers starting at once cannot interleave. Every applied file is recorded in
// public.truck_log_schema_migrations with its SHA-256. An applied file must never
// change: if it does, startup stops instead of guessing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/truck-log/migrations');
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = "hashtext('truck-log'), hashtext('schema-migrations')";

/** Normalize line endings so a CRLF checkout on Windows does not look like an edit. */
export function checksum(sql) {
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** Read and validate the migration files in order. */
export function loadMigrations(dir = MIGRATIONS_DIR) {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  const migrations = files.map((file) => {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Migration file name must look like 0002_short_name.sql: ${file}`);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    return { version: match[1], name: match[2], file, sql, checksum: checksum(sql) };
  });
  migrations.forEach((migration, index) => {
    const expected = String(index + 1).padStart(4, '0');
    if (migration.version !== expected) throw new Error(`Migrations must be numbered without gaps: expected ${expected}, found ${migration.file}`);
  });
  if (!migrations.length) throw new Error(`No migrations found in ${dir}`);
  return migrations;
}

async function appliedMigrations(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS public.truck_log_schema_migrations (
    version char(4) PRIMARY KEY,
    name text NOT NULL,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query('SELECT version, name, checksum, applied_at FROM public.truck_log_schema_migrations ORDER BY version');
  return new Map(rows.map((row) => [row.version, row]));
}

/** Refuse to adopt a database that has tables but no migration history (an old 0.1 test database). */
async function assertAdoptable(client, applied) {
  if (applied.size) return;
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM pg_tables
    WHERE schemaname IN ('public', 'truck_log_admin') AND tablename <> 'truck_log_schema_migrations'`);
  if (rows[0].n > 0) {
    throw new Error('This database already has Truck Log tables but no migration history. It was created by an '
      + 'older test build and cannot be upgraded in place. If it holds only test data, run REMOVE-OLD-TRUCK-LOG-INSTALL with -All (Windows) or --all (Linux). See README.md, "Replacing an older test install".');
  }
}

/** Apply pending migrations. Returns the list of versions applied. */
export async function migrate(client, { dir = MIGRATIONS_DIR, log = console.log, statusOnly = false } = {}) {
  const migrations = loadMigrations(dir);
  await client.query(`SELECT pg_advisory_lock(${LOCK_KEY})`);
  try {
    // Check an unknown database before writing anything to it.
    let applied = await readOnlyApplied(client);
    if (!statusOnly) {
      await assertAdoptable(client, applied);
      applied = await appliedMigrations(client);
    }
    for (const [version, row] of applied) {
      const file = migrations.find((m) => m.version === version);
      if (!file) throw new Error(`Database has migration ${version} (${row.name}) but this release does not. Use the matching or a newer Truck Log release.`);
      if (file.checksum !== row.checksum.trim()) {
        throw new Error(`Migration ${file.file} changed after it was applied. Restore the original file; put new changes in a new migration.`);
      }
    }
    const pending = migrations.filter((m) => !applied.has(m.version));
    if (statusOnly) {
      for (const m of migrations) log(`${applied.has(m.version) ? 'applied' : 'PENDING'}  ${m.file}`);
      return [];
    }
    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '30s'");
        await client.query("SET LOCAL statement_timeout = '600s'");
        await client.query('SET LOCAL search_path = public, pg_catalog');
        await client.query(migration.sql);
        await client.query('SET LOCAL search_path = public, pg_catalog');
        await client.query('INSERT INTO public.truck_log_schema_migrations(version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum]);
        await client.query('COMMIT');
        log(`[PASS] Applied migration ${migration.file}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        error.message = `Migration ${migration.file} failed and was rolled back: ${error.message}`;
        throw error;
      }
    }
    if (!pending.length) log(`[PASS] Database schema is current (${migrations.length} migrations).`);
    return pending.map((m) => m.version);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  }
}

/** Throw unless every migration in this release has been applied (used by operator tools). */
export async function assertSchemaCurrent(client, { dir = MIGRATIONS_DIR } = {}) {
  const migrations = loadMigrations(dir);
  const applied = await readOnlyApplied(client);
  const missing = migrations.filter((m) => applied.get(m.version)?.checksum?.trim() !== m.checksum);
  if (missing.length) {
    throw new Error(`Database schema is not current (pending or changed: ${missing.map((m) => m.file).join(', ')}). Start the Truck Log server once so it applies migrations.`);
  }
}

async function readOnlyApplied(client) {
  const exists = await client.query("SELECT to_regclass('public.truck_log_schema_migrations') AS t");
  if (!exists.rows[0].t) return new Map();
  const { rows } = await client.query('SELECT version, name, checksum, applied_at FROM public.truck_log_schema_migrations ORDER BY version');
  return new Map(rows.map((row) => [row.version, row]));
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--status');
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(' ')}. Usage: migrate.mjs [--status]`);
  if (String(process.env.TRUCK_LOG_DATABASE_SYNCHRONIZE ?? 'false').toLowerCase() !== 'false') {
    throw new Error('TRUCK_LOG_DATABASE_SYNCHRONIZE must be false; migrations own the schema.');
  }
  const { createTruckLogDatabaseClient } = await import('./database-tooling.mjs');
  const client = createTruckLogDatabaseClient();
  await client.connect();
  try {
    await migrate(client, { statusOnly: args.includes('--status') });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[FAIL] Database migration: ${error.message}`);
    process.exitCode = 1;
  });
}
