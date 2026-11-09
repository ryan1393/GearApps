import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

const env = { ...loadDotEnv(path.join(root, '.env')), ...process.env };
for (const key of ['DATABASE_HOST','DATABASE_PORT','DATABASE_USERNAME','DATABASE_PASSWORD','DATABASE_NAME']) {
  if (!env[key]) throw new Error(`Missing ${key} in project .env/environment.`);
}

if (!process.argv.includes('--apply')) {
  console.log('[SAFE] Target PostgreSQL was NOT changed.');
  console.log('Re-run this helper with --apply only from the full refresh workflow.');
  process.exit(0);
}

const client = new Client({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT),
  user: env.DATABASE_USERNAME,
  password: String(env.DATABASE_PASSWORD),
  database: env.DATABASE_NAME,
});

const excluded = new Set(['typeorm_metadata', 'migrations', 'spatial_ref_sys']);
const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`;

await client.connect();
try {
  const { rows: tableRows } = await client.query(`
    SELECT tablename
      FROM pg_tables
     WHERE schemaname='public'
     ORDER BY tablename
  `);
  const tables = tableRows.map((row) => row.tablename).filter((name) => !excluded.has(name));
  if (!tables.length) throw new Error('No application tables were found in public schema.');

  const counts = [];
  let totalRows = 0;
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(table)}`);
    const count = Number(result.rows[0]?.count ?? 0);
    counts.push({ table, count });
    totalRows += count;
  }

  const manifestDir = path.join(root, 'tools', 'data-import', 'work');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'pre-reset-target-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      database_host: env.DATABASE_HOST,
      database_name: env.DATABASE_NAME,
      table_count: tables.length,
      total_rows_before_reset: totalRows,
      rows_by_table: counts,
      note: 'Counts only. The old rows were intentionally not backed up by this reset workflow.',
    }, null, 2) + '\n',
  );

  console.log(`[TARGET] ${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`);
  console.log(`[TARGET] ${tables.length} application tables; ${totalRows} rows before reset.`);
  console.log(`[AUDIT]  ${manifestPath}`);

  await client.query('BEGIN');
  try {
    const tableList = tables.map(quoteIdent).join(', ');
    await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  let remaining = 0;
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(table)}`);
    remaining += Number(result.rows[0]?.count ?? 0);
  }
  if (remaining !== 0) throw new Error(`Target reset verification failed: ${remaining} rows remain.`);

  console.log('[PASS] Old PostgreSQL application data deleted. Schema was preserved.');
} finally {
  await client.end();
}
