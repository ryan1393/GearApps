import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  workspaceRoot,
  loadDb,
  tableColumns,
  assertCurrentReferenceSchema,
} from './db-common.mjs';

/**
 * Canonical Fort Wayne dock configuration.
 *
 * Keep this list aligned with the fresh database seed and
 * reference-data-import/truck-log-dock-master.csv. The release validation
 * suite checks all three sources so the repair utility cannot silently drift
 * from a new installation.
 */
export const AUTHORITATIVE_DOCKS = Object.freeze([
  { code: '7',  description: 'West',           sortOrder: 10 },
  { code: '25', description: 'Carrier',        sortOrder: 20 },
  { code: '28', description: 'Receiving',      sortOrder: 30 },
  { code: '41', description: 'North Building', sortOrder: 40 },
  { code: '49', description: 'Steel Coil',     sortOrder: 50 },
  { code: '52', description: 'Long Bar',       sortOrder: 60 },
  { code: '61', description: 'Tube',           sortOrder: 70 },
  { code: '62', description: 'Tube',           sortOrder: 80 },
  { code: '68', description: 'Forge',          sortOrder: 90 },
]);

async function dockColumns(client) {
  const rows = await tableColumns(client, 'docks');
  if (!rows.length) throw new Error('public.docks was not found.');
  const cols = new Map(rows.map((row) => [String(row.column_name), row]));
  for (const required of ['id', 'code', 'description', 'active', 'sort_order']) {
    if (!cols.has(required)) throw new Error(`Required public.docks.${required} column is missing.`);
  }
  const id = cols.get('id');
  if (id?.is_nullable === 'NO' && id?.column_default == null) {
    throw new Error('public.docks.id has no database default; refusing to guess an ID strategy.');
  }
  return cols;
}

async function upsertDock(client, cols, dock) {
  const fields = ['code', 'description', 'active', 'sort_order'];
  const values = ['$1', '$2', 'TRUE', '$3'];
  const params = [dock.code, dock.description, dock.sortOrder];
  if (cols.has('created_at')) { fields.push('created_at'); values.push('NOW()'); }
  if (cols.has('updated_at')) { fields.push('updated_at'); values.push('NOW()'); }

  const sets = [
    'description=EXCLUDED.description',
    'active=TRUE',
    'sort_order=EXCLUDED.sort_order',
  ];
  if (cols.has('updated_at')) sets.push('updated_at=NOW()');

  await client.query(
    `INSERT INTO public.docks (${fields.map((field) => `"${field}"`).join(',')})
     VALUES (${values.join(',')})
     ON CONFLICT (code) DO UPDATE SET ${sets.join(',')}`,
    params,
  );
}

async function verifyExact(client) {
  const result = await client.query(
    `SELECT code::text AS code,
            description::text AS description,
            active,
            sort_order::int AS sort_order
       FROM public.docks
      ORDER BY sort_order, code`,
  );

  if (result.rowCount !== AUTHORITATIVE_DOCKS.length) {
    throw new Error(`Expected exactly ${AUTHORITATIVE_DOCKS.length} dock rows; found ${result.rowCount}.`);
  }

  for (let index = 0; index < AUTHORITATIVE_DOCKS.length; index += 1) {
    const expected = AUTHORITATIVE_DOCKS[index];
    const actual = result.rows[index];
    const code = String(actual?.code ?? '').trim();
    const description = String(actual?.description ?? '').trim();
    const active = actual?.active === true;
    const sortOrder = Number(actual?.sort_order);
    if (
      code !== expected.code ||
      description !== expected.description ||
      !active ||
      sortOrder !== expected.sortOrder
    ) {
      throw new Error(
        `Dock verification failed at position ${index + 1}: expected ` +
        `${expected.code}/${expected.description}/active/${expected.sortOrder}, got ` +
        `${code}/${description}/${String(actual?.active)}/${String(actual?.sort_order)}.`,
      );
    }
  }
}

/**
 * Apply the exact dock master in a transaction. `commit=false` executes the
 * complete mutation and verification path but rolls it back, which is used as
 * the safety preflight before the final transaction.
 */
export async function syncPass(client, commit) {
  const cols = await dockColumns(client);
  await client.query('BEGIN');
  try {
    for (const dock of AUTHORITATIVE_DOCKS) await upsertDock(client, cols, dock);
    const codes = AUTHORITATIVE_DOCKS.map((dock) => dock.code);
    await client.query('DELETE FROM public.docks WHERE NOT (code = ANY($1::text[]))', [codes]);
    await verifyExact(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  }
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = workspaceRoot(here);
  const { Client, config } = loadDb(root);
  const client = new Client(config);
  await client.connect();
  try {
    console.log('\n============================================================');
    console.log(' TRUCK LOG - AUTHORITATIVE DOCK MASTER');
    console.log('============================================================\n');
    console.log(`[INFO] Database: ${config.host}:${config.port}/${config.database}`);
    console.log('[INFO] Exact authoritative Dock master:');
    for (const dock of AUTHORITATIVE_DOCKS) console.log(`       ${dock.code.padStart(2)}  ${dock.description}`);

    await assertCurrentReferenceSchema(client);
    console.log('\n[INFO] Running full rollback-only database preflight...');
    await syncPass(client, false);
    console.log('[PASS] PRE-FLIGHT completed and rolled back.');
    console.log('[INFO] Preflight passed. Applying exact Dock master for real...');
    await syncPass(client, true);
    console.log('[PASS] FINAL IMPORT committed.');
    console.log(`[PASS] public.docks now contains exactly ${AUTHORITATIVE_DOCKS.length} authoritative active rows in the expected order.`);
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error('\n[FAIL] Authoritative Dock sync failed; PostgreSQL transaction was rolled back.');
    console.error(error);
    process.exitCode = 1;
  });
}
