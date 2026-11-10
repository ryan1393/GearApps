import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

if (!process.argv.includes('--apply')) {
  console.log('[SAFE] System-reference bootstrap was NOT applied.');
  process.exit(0);
}

const env = { ...loadDotEnv(path.resolve(root, '..', '.env')), ...process.env };
for (const key of [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
]) {
  if (!env[key]) throw new Error(`Missing ${key} in project .env/environment.`);
}

const client = new Client({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT),
  user: env.DATABASE_USERNAME,
  password: String(env.DATABASE_PASSWORD),
  database: env.DATABASE_NAME,
});

const id = () => crypto.randomUUID();

const simpleRefs = [
  {
    table: 'cutter_event_types',
    rows: [
      ['CB', 'Cutter Build', 'Cutter Builder build or rebuild', 10],
      ['CS', 'Cutter Setup', 'Cutter setup on a production machine', 20],
      ['FC', 'Frequency Check', 'Periodic production quality check', 30],
      ['CMM', 'CMM Check', 'CMM / Zeiss quality check', 40],
      ['CP', 'Cutter Pull', 'Cutter removed for dull, damage, or other pull reason', 50],
      ['CC', 'Changeover', 'Usable cutter removed for changeover and returned to shelf', 60],
      ['TD', 'Cutter Teardown', 'Cutter Builder teardown and blade disposition', 70],
    ],
  },
  {
    table: 'cutter_build_statuses',
    rows: [
      ['BUILDING', 'Building', 'Currently being assembled in Cutter Builder', 10],
      ['READY', 'Ready', 'Built and available for setup', 20],
      ['RUNNING', 'Running', 'Currently installed on a machine', 30],
      ['SHELF', 'Shelf', 'Usable build returned to shelf after changeover', 40],
      ['PULLED', 'Pulled', 'Removed and awaiting Cutter Builder disposition', 50],
      ['CLOSED', 'Closed', 'Build cycle complete; body is ready for rebuild', 60],
    ],
  },
  {
    table: 'part_types',
    rows: [
      ['RING', 'Ring', 'Ring cutter / blade set', 10],
      ['PINION', 'Pinion', 'Pinion cutter / blade set', 20],
    ],
  },
  {
    table: 'tray_stages',
    rows: [
      ['EMPTY', 'Empty', 'Empty reusable tray', 10],
      ['WAITING_FOR_GRINDING', 'Waiting for Grinding', 'Returned cutter blades stored on shelf before grinding', 20],
      ['GRINDING', 'Grinding', 'Tray is actively in Cutter Builder grinding/resharpening', 30],
      ['READY_FOR_COATING', 'Ready for Coating', 'Grinding complete and exact blade quantity enforced', 40],
      ['AT_COATER', 'At Coater', 'Tray is loaded for external coating', 50],
      ['READY_FOR_CUTTER', 'Ready for Cutter', 'Returned from coating and stored on shelf', 60],
    ],
  },
  {
    table: 'cutter_check_results',
    rows: [
      ['PASS', 'Pass', 'Quality check passed', 10],
      ['FAIL', 'Fail', 'Quality check failed', 20],
      ['HOLD', 'Hold', 'Quality check requires review before continuing', 30],
    ],
  },
];

await client.connect();
try {
  await client.query('BEGIN');

  for (const group of simpleRefs) {
    for (const [code, name, description, sortOrder] of group.rows) {
      await client.query(
        `INSERT INTO ${group.table}
          (id, code, name, description, sort_order, enabled, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,true,NOW(),NOW())
         ON CONFLICT (code) DO UPDATE
         SET name=EXCLUDED.name,
             description=EXCLUDED.description,
             sort_order=EXCLUDED.sort_order,
             enabled=true,
             "updatedAt"=NOW()`,
        [id(), code, name, description, sortOrder],
      );
    }
  }

  const pullReasons = [
    ['DULL', 'Dull', 'Cutter is dull and must return to Cutter Builder for teardown/rebuild', true, false, 10],
    ['DAMAGED', 'Damaged', 'Cutter or blade damage requires Cutter Builder teardown/rebuild', true, false, 20],
    ['CHANGEOVER', 'Changeover', 'Usable cutter removed for changeover and returned to a Greenshed shelf', false, true, 30],
    ['QUALITY', 'Quality Issue', 'Cutter pulled because of a quality concern', true, false, 40],
    ['OTHER', 'Other', 'Other pull reason requiring Cutter Builder disposition', true, false, 50],
  ];

  for (const [code, name, description, requiresTeardown, returnsToShelf, sortOrder] of pullReasons) {
    await client.query(
      `INSERT INTO cutter_pull_reasons
        (id, code, name, description, requires_teardown, returns_to_shelf,
         sort_order, enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW())
       ON CONFLICT (code) DO UPDATE
       SET name=EXCLUDED.name,
           description=EXCLUDED.description,
           requires_teardown=EXCLUDED.requires_teardown,
           returns_to_shelf=EXCLUDED.returns_to_shelf,
           sort_order=EXCLUDED.sort_order,
           enabled=true,
           "updatedAt"=NOW()`,
      [id(), code, name, description, requiresTeardown, returnsToShelf, sortOrder],
    );
  }

  const required = await client.query(`
    SELECT code
      FROM part_types
     WHERE code IN ('RING','PINION') AND enabled=true
     ORDER BY code
  `);

  const codes = new Set(required.rows.map((row) => row.code));
  if (!codes.has('RING') || !codes.has('PINION')) {
    throw new Error('System-reference bootstrap verification failed: RING/PINION are missing.');
  }

  await client.query('COMMIT');
  console.log('[PASS] System reference data bootstrapped after target reset.');
  console.log('[PASS] RING/PINION part types are available for base-data import.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
