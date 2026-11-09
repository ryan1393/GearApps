// Migration runner and migration-file contract. Runs without PostgreSQL: the
// database is an in-memory fake that records statements and models the
// schema_migrations table, transactions and the advisory lock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checksum, loadMigrations, migrate, assertSchemaCurrent, MIGRATIONS_DIR } from '../../tools/truck-log/migrate.mjs';

let count = 0;
async function test(name, fn) { await fn(); count++; console.log(`[PASS] ${name}`); }

function fakeDb({ tables = [], applied = [], failOn = null } = {}) {
  const state = { tables: new Set(tables), history: new Map(applied.map((r) => [r.version, r])), log: [], inTx: false, pending: null, locked: 0 };
  return {
    state,
    async query(sql, params = []) {
      state.log.push(sql);
      if (failOn && sql.includes(failOn)) throw new Error('injected failure');
      if (/pg_advisory_lock\(/.test(sql)) { state.locked++; return { rows: [] }; }
      if (/pg_advisory_unlock\(/.test(sql)) { state.locked--; return { rows: [] }; }
      if (sql === 'BEGIN') { state.inTx = true; state.pending = []; return { rows: [] }; }
      if (sql === 'COMMIT') { for (const r of state.pending) state.history.set(r.version, r); state.inTx = false; state.pending = null; return { rows: [] }; }
      if (sql === 'ROLLBACK') { state.inTx = false; state.pending = null; return { rows: [] }; }
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS public.truck_log_schema_migrations')) { state.tables.add('truck_log_schema_migrations'); return { rows: [] }; }
      if (sql.includes("to_regclass('public.truck_log_schema_migrations')")) return { rows: [{ t: state.tables.has('truck_log_schema_migrations') ? 'x' : null }] };
      if (sql.startsWith('SELECT version, name, checksum, applied_at FROM public.truck_log_schema_migrations')) return { rows: [...state.history.values()].sort((a, b) => a.version.localeCompare(b.version)) };
      if (sql.includes('FROM pg_tables')) return { rows: [{ n: [...state.tables].filter((t) => t !== 'truck_log_schema_migrations').length }] };
      if (sql.startsWith('INSERT INTO public.truck_log_schema_migrations')) { state.pending.push({ version: params[0], name: params[1], checksum: params[2] }); return { rows: [] }; }
      return { rows: [] };
    },
  };
}

function tempMigrations(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-migrations-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}
const quiet = () => {};

// --- the shipped migration files
const shipped = loadMigrations();
await test('Shipped migrations are numbered 0001.. without gaps', () => {
  assert.deepEqual(shipped.map((m) => m.version), shipped.map((_, i) => String(i + 1).padStart(4, '0')));
  assert.equal(shipped[0].file, '0001_baseline.sql');
});
await test('Baseline creates the full Truck Log schema and seed data', () => {
  const sql = shipped[0].sql;
  const tables = [...sql.matchAll(/^CREATE TABLE (\w+)\.(\w+) \(/gm)].map((m) => `${m[1]}.${m[2]}`);
  assert.equal(tables.length, 35, `expected 35 tables, found ${tables.length}`);
  for (const t of ['public.truck_visits', 'public.visit_documents', 'public.docks', 'public.rxo_orders', 'public.driver_print_packages',
    'public.automatic_driver_print_jobs', 'public.rxo_expedite_shipment_snapshots', 'truck_log_admin.users', 'truck_log_admin.sessions']) {
    assert.ok(tables.includes(t), `baseline is missing ${t}`);
  }
  assert.equal((sql.match(/^CREATE FUNCTION /gm) || []).length, 18, 'baseline has 18 functions');
  assert.equal((sql.match(/^CREATE TRIGGER /gm) || []).length, 18, 'baseline has 18 triggers');
  assert.equal((sql.match(/^CREATE VIEW /gm) || []).length, 2, 'baseline has 2 views');
  assert.match(sql, /\('site_name', 'Dana Fort Wayne Plant'/);
  for (const [code, description] of [['7', 'West'], ['25', 'Carrier'], ['28', 'Receiving'], ['41', 'North Building'], ['49', 'Steel Coil'], ['52', 'Long Bar'], ['61', 'Tube'], ['62', 'Tube'], ['68', 'Forge']]) {
    assert.match(sql, new RegExp(`\\(\\d+, '${code}', '${description}', true, \\d+,`), `dock ${code} is seeded`);
  }
  assert.match(sql, /\(1, 'truck-log-admin-v1', now\(\)\)/, 'admin schema version is v1');
  assert.doesNotMatch(sql, /\('automatic_driver_print_schema_v1'/, 'old runner checksum row is gone');
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m, 'migrations do not manage their own transactions');
});
await test('Every migration file is plain SQL without transaction control', () => {
  for (const m of shipped) assert.doesNotMatch(m.sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m, m.file);
});
await test('Checksums ignore CRLF line endings', () => {
  assert.equal(checksum('SELECT 1;\r\nSELECT 2;\r\n'), checksum('SELECT 1;\nSELECT 2;\n'));
});

// --- the runner, against a fake database
const dir = tempMigrations({ '0001_baseline.sql': 'CREATE TABLE a();', '0002_second.sql': 'CREATE TABLE b();' });
await test('Empty database: every migration runs in its own transaction and is recorded', async () => {
  const db = fakeDb();
  const applied = await migrate(db, { dir, log: quiet });
  assert.deepEqual(applied, ['0001', '0002']);
  assert.equal(db.state.log.filter((q) => q === 'BEGIN').length, 2);
  assert.equal(db.state.log.filter((q) => q === 'COMMIT').length, 2);
  assert.deepEqual([...db.state.history.keys()], ['0001', '0002']);
  assert.equal(db.state.locked, 0, 'advisory lock released');
});
await test('Second run is a no-op', async () => {
  const db = fakeDb();
  await migrate(db, { dir, log: quiet });
  db.state.log.length = 0;
  assert.deepEqual(await migrate(db, { dir, log: quiet }), []);
  assert.ok(!db.state.log.includes('BEGIN'));
});
await test('Only pending migrations run on an older database', async () => {
  const first = loadMigrations(dir)[0];
  const db = fakeDb({ tables: ['a', 'truck_log_schema_migrations'], applied: [{ version: '0001', name: 'baseline', checksum: first.checksum }] });
  assert.deepEqual(await migrate(db, { dir, log: quiet }), ['0002']);
});
await test('An edited applied migration stops startup', async () => {
  const db = fakeDb({ tables: ['a', 'truck_log_schema_migrations'], applied: [{ version: '0001', name: 'baseline', checksum: 'f'.repeat(64) }] });
  await assert.rejects(migrate(db, { dir, log: quiet }), /changed after it was applied/);
  assert.ok(!db.state.log.includes('BEGIN'), 'nothing applied');
  assert.equal(db.state.locked, 0, 'lock released after refusal');
});
await test('A database newer than this release is refused', async () => {
  const files = loadMigrations(dir);
  const db = fakeDb({ tables: ['a', 'truck_log_schema_migrations'], applied: [...files.map((m) => ({ version: m.version, name: m.name, checksum: m.checksum })), { version: '0003', name: 'future', checksum: 'a'.repeat(64) }] });
  await assert.rejects(migrate(db, { dir, log: quiet }), /this release does not/);
});
await test('An old 0.1 test database (tables, no history) is refused, not modified', async () => {
  const db = fakeDb({ tables: ['truck_visits', 'docks'] });
  await assert.rejects(migrate(db, { dir, log: quiet }), /older test build/);
  assert.ok(!db.state.log.includes('BEGIN'));
  assert.ok(!db.state.tables.has('truck_log_schema_migrations'), 'nothing is written to a refused database');
});
await test('A failing migration rolls back and is not recorded', async () => {
  const db = fakeDb({ failOn: 'CREATE TABLE b' });
  await assert.rejects(migrate(db, { dir, log: quiet }), /0002_second\.sql failed and was rolled back/);
  assert.deepEqual([...db.state.history.keys()], ['0001']);
  assert.ok(db.state.log.includes('ROLLBACK'));
  assert.equal(db.state.locked, 0);
});
await test('Status mode changes nothing', async () => {
  const db = fakeDb();
  const lines = [];
  await migrate(db, { dir, log: (l) => lines.push(l), statusOnly: true });
  assert.deepEqual(lines, ['PENDING  0001_baseline.sql', 'PENDING  0002_second.sql']);
  assert.ok(!db.state.tables.has('truck_log_schema_migrations'));
});
await test('Operator tools refuse a database that is not migrated', async () => {
  await assert.rejects(assertSchemaCurrent(fakeDb(), { dir }), /not current/);
  const db = fakeDb();
  await migrate(db, { dir, log: quiet });
  await assertSchemaCurrent(db, { dir });
});
await test('Bad file names and numbering gaps are rejected', () => {
  assert.throws(() => loadMigrations(tempMigrations({ '0001_a.sql': '', '0003_c.sql': '' })), /without gaps/);
  assert.throws(() => loadMigrations(tempMigrations({ '1_a.sql': '' })), /must look like/);
});

// --- wiring
await test('Server image ships the migrations and runs them before the API', () => {
  const docker = fs.readFileSync('docker/truck-log/server.Dockerfile', 'utf8');
  const entry = fs.readFileSync('docker/truck-log/server-entrypoint.sh', 'utf8');
  assert.ok(docker.includes('COPY database/truck-log/migrations ./database/truck-log/migrations'));
  assert.ok(docker.includes('tools/truck-log/migrate.mjs'));
  assert.ok(entry.indexOf('node ./tools/truck-log/migrate.mjs') > 0 && entry.indexOf('node ./tools/truck-log/migrate.mjs') < entry.indexOf('exec node'));
  assert.equal(path.resolve(MIGRATIONS_DIR), path.resolve('database/truck-log/migrations'));
});

console.log(`[PASS] Migration contract: ${count} checks.`);
