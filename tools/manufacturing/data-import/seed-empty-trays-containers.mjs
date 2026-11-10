import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const TRAY_COUNT = 300;
const CONTAINER_COUNT = 100;
const TRAY_PREFIX = 'T';
const CONTAINER_PREFIX = 'C';

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;

  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;

    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[line.slice(0, i).trim()] = value;
  }

  return out;
}

function serial(prefix, value, width = 4) {
  return `${prefix}${String(value).padStart(width, '0')}`;
}

if (!process.argv.includes('--apply')) {
  console.log('[SAFE] Empty tray/container seed was NOT applied.');
  console.log(`[SAFE] Would create ${TRAY_COUNT} empty trays: ${serial(TRAY_PREFIX, 1)} .. ${serial(TRAY_PREFIX, TRAY_COUNT)}`);
  console.log(`[SAFE] Would create ${CONTAINER_COUNT} empty containers: ${serial(CONTAINER_PREFIX, 1)} .. ${serial(CONTAINER_PREFIX, CONTAINER_COUNT)}`);
  process.exit(0);
}

const env = {
  ...loadDotEnv(path.resolve(projectRoot, '.env')),
  ...process.env,
};

for (const key of [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
]) {
  if (!env[key]) {
    throw new Error(`Missing ${key} in project .env/environment.`);
  }
}

const client = new Client({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT),
  user: env.DATABASE_USERNAME,
  password: String(env.DATABASE_PASSWORD),
  database: env.DATABASE_NAME,
});

await client.connect();

try {
  await client.query('BEGIN');

  const emptyStageResult = await client.query(`
    SELECT id
      FROM tray_stages
     WHERE code = 'EMPTY'
       AND enabled = true
     LIMIT 1
  `);

  const emptyStageId = emptyStageResult.rows[0]?.id;
  if (!emptyStageId) {
    throw new Error(
      'EMPTY tray stage is not configured. Run the system-reference bootstrap first.',
    );
  }

  for (let n = 1; n <= TRAY_COUNT; n += 1) {
    const traySerial = serial(TRAY_PREFIX, n);

    await client.query(
      `INSERT INTO trays
        (
          id,
          "createdAt",
          "updatedAt",
          serial_number,
          blade_count,
          summary_id,
          part_type_id,
          grinding_completed_at,
          required_blade_count,
          current_stage_id,
          enabled
        )
       VALUES
        ($1, NOW(), NOW(), $2, 0, NULL, NULL, NULL, NULL, $3, true)
       ON CONFLICT (serial_number) DO UPDATE
       SET blade_count = 0,
           summary_id = NULL,
           part_type_id = NULL,
           grinding_completed_at = NULL,
           required_blade_count = NULL,
           current_stage_id = EXCLUDED.current_stage_id,
           enabled = true,
           "updatedAt" = NOW()`,
      [crypto.randomUUID(), traySerial, emptyStageId],
    );
  }

  for (let n = 1; n <= CONTAINER_COUNT; n += 1) {
    const containerSerial = serial(CONTAINER_PREFIX, n);

    await client.query(
      `INSERT INTO containers
        (
          id,
          "createdAt",
          "updatedAt",
          serial_number,
          enabled
        )
       VALUES
        ($1, NOW(), NOW(), $2, true)
       ON CONFLICT (serial_number) DO UPDATE
       SET enabled = true,
           "updatedAt" = NOW()`,
      [crypto.randomUUID(), containerSerial],
    );
  }

  const trayVerification = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (
         WHERE blade_count = 0
           AND summary_id IS NULL
           AND part_type_id IS NULL
           AND grinding_completed_at IS NULL
           AND required_blade_count IS NULL
           AND current_stage_id = $1
           AND enabled = true
       )::int AS empty_count
     FROM trays
     WHERE serial_number ~ '^T[0-9]{4}$'
       AND substring(serial_number from 2)::int BETWEEN 1 AND $2`,
    [emptyStageId, TRAY_COUNT],
  );

  const containerVerification = await client.query(
    `SELECT COUNT(*)::int AS total
       FROM containers
      WHERE serial_number ~ '^C[0-9]{4}$'
        AND substring(serial_number from 2)::int BETWEEN 1 AND $1
        AND enabled = true`,
    [CONTAINER_COUNT],
  );

  const assignmentVerification = await client.query(
    `SELECT
       (
         SELECT COUNT(*)::int
           FROM blade_tray bt
           JOIN trays t ON t.id = bt.tray_id
          WHERE bt.enabled = true
            AND t.serial_number ~ '^T[0-9]{4}$'
            AND substring(t.serial_number from 2)::int BETWEEN 1 AND $1
       ) AS blade_assignments,
       (
         SELECT COUNT(*)::int
           FROM location_tray lt
           JOIN trays t ON t.id = lt.tray_id
          WHERE lt.enabled = true
            AND t.serial_number ~ '^T[0-9]{4}$'
            AND substring(t.serial_number from 2)::int BETWEEN 1 AND $1
       ) AS location_assignments,
       (
         SELECT COUNT(*)::int
           FROM container_tray ct
           JOIN trays t ON t.id = ct.tray_id
          WHERE ct.enabled = true
            AND t.serial_number ~ '^T[0-9]{4}$'
            AND substring(t.serial_number from 2)::int BETWEEN 1 AND $1
       ) AS tray_container_assignments,
       (
         SELECT COUNT(*)::int
           FROM container_tray ct
           JOIN containers c ON c.id = ct.container_id
          WHERE ct.enabled = true
            AND c.serial_number ~ '^C[0-9]{4}$'
            AND substring(c.serial_number from 2)::int BETWEEN 1 AND $2
       ) AS container_assignments`,
    [TRAY_COUNT, CONTAINER_COUNT],
  );

  const trayStats = trayVerification.rows[0];
  const containerStats = containerVerification.rows[0];
  const assignments = assignmentVerification.rows[0];

  if (
    trayStats.total !== TRAY_COUNT ||
    trayStats.empty_count !== TRAY_COUNT
  ) {
    throw new Error(
      `Expected ${TRAY_COUNT} seeded EMPTY trays; found ${trayStats.total} managed trays and ${trayStats.empty_count} fully empty.`,
    );
  }

  if (containerStats.total !== CONTAINER_COUNT) {
    throw new Error(
      `Expected ${CONTAINER_COUNT} seeded empty containers; found ${containerStats.total}.`,
    );
  }

  for (const [name, count] of Object.entries(assignments)) {
    if (Number(count) !== 0) {
      throw new Error(
        `Seeded inventory is not empty: ${name}=${count}. Full reset must leave every seeded tray/container unassigned.`,
      );
    }
  }

  await client.query('COMMIT');

  console.log(
    `[PASS] Seeded ${TRAY_COUNT} EMPTY trays (${serial(TRAY_PREFIX, 1)} .. ${serial(TRAY_PREFIX, TRAY_COUNT)}).`,
  );
  console.log(
    `[PASS] Seeded ${CONTAINER_COUNT} empty containers (${serial(CONTAINER_PREFIX, 1)} .. ${serial(CONTAINER_PREFIX, CONTAINER_COUNT)}).`,
  );
  console.log(
    '[PASS] All seeded trays have 0 blades, no Summary/Part Type, EMPTY stage, and no active location/container assignment.',
  );
  console.log(
    '[PASS] All seeded containers have no active tray assignments.',
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
