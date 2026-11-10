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
);

const TRAY_COUNT = 300;
const CONTAINER_COUNT = 100;
const MOCK_SUMMARY_SETS = 12;
const MOCK_CONTAINER_LOADS = 10;
const TRAY_PREFIX = 'T';
const CONTAINER_PREFIX = 'C';
const MOCK_BLADE_PREFIX = 'MOCK-BLADE-';
const MOCK_BUILD_PREFIX = 'MOCK-BUILD-';
const MOCK_BODY_PREFIX = 'MOCK-BODY-';

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

function normalizeSummary(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isShelfSummary(value) {
  const summary = normalizeSummary(value);
  return /^(?=.*\d)[A-Z0-9.-]+$/.test(summary);
}

function roundRobinRequirements(rows) {
  const groups = new Map();
  for (const row of rows) {
    const code = String(row.part_type_code ?? '').toUpperCase();
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(row);
  }

  const preferred = ['RING', 'PINION'];
  const codes = [
    ...preferred.filter((code) => groups.has(code)),
    ...[...groups.keys()].filter((code) => !preferred.includes(code)).sort(),
  ];

  const output = [];
  let index = 0;
  while (output.length < rows.length) {
    let added = false;
    for (const code of codes) {
      const group = groups.get(code) ?? [];
      if (group[index]) {
        output.push(group[index]);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  return output;
}

async function one(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] ?? null;
}

async function ensureLocation(
  client,
  serialNumber,
  number,
  description,
  department,
  locationType,
) {
  const existing = await one(
    client,
    `SELECT id, serial_number, number, description, department, location_type, enabled
       FROM locations
      WHERE upper(serial_number)=upper($1)
      LIMIT 1`,
    [serialNumber],
  );

  if (existing) {
    await client.query(
      `UPDATE locations
          SET number=$2,
              description=$3,
              department=$4,
              location_type=$5,
              enabled=true,
              "updatedAt"=NOW()
        WHERE id=$1`,
      [
        existing.id,
        number,
        description,
        department,
        locationType,
      ],
    );
    return { ...existing, number, department, location_type: locationType };
  }

  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO locations
      (
        id, "createdAt", "updatedAt",
        serial_number, number, description, department, location_type, enabled
      )
     VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,true)`,
    [id, serialNumber, number, description, department, locationType],
  );

  return {
    id,
    serial_number: serialNumber,
    number,
    department,
    location_type: locationType,
  };
}

async function ensurePhysicalInventory(client, emptyStageId) {
  for (let n = 1; n <= TRAY_COUNT; n += 1) {
    await client.query(
      `INSERT INTO trays
        (
          id, "createdAt", "updatedAt",
          serial_number, blade_count, summary_id, part_type_id,
          grinding_completed_at, required_blade_count,
          current_stage_id, enabled
        )
       VALUES ($1,NOW(),NOW(),$2,0,NULL,NULL,NULL,NULL,$3,true)
       ON CONFLICT (serial_number) DO UPDATE
       SET enabled=true,
           "updatedAt"=NOW()`,
      [crypto.randomUUID(), serial(TRAY_PREFIX, n), emptyStageId],
    );
  }

  for (let n = 1; n <= CONTAINER_COUNT; n += 1) {
    await client.query(
      `INSERT INTO containers
        (id, "createdAt", "updatedAt", serial_number, enabled)
       VALUES ($1,NOW(),NOW(),$2,true)
       ON CONFLICT (serial_number) DO UPDATE
       SET enabled=true, "updatedAt"=NOW()`,
      [crypto.randomUUID(), serial(CONTAINER_PREFIX, n)],
    );
  }
}

async function assertManagedInventoryIsUnused(client) {
  const result = await one(
    client,
    `SELECT
       (
         SELECT COUNT(*)::int
           FROM blade_tray bt
           JOIN trays t ON t.id=bt.tray_id
          WHERE bt.enabled=true
            AND t.serial_number ~ '^T[0-9]{4}$'
       ) AS blade_assignments,
       (
         SELECT COUNT(*)::int
           FROM location_tray lt
           JOIN trays t ON t.id=lt.tray_id
          WHERE lt.enabled=true
            AND t.serial_number ~ '^T[0-9]{4}$'
       ) AS location_assignments,
       (
         SELECT COUNT(*)::int
           FROM container_tray ct
           JOIN trays t ON t.id=ct.tray_id
          WHERE ct.enabled=true
            AND t.serial_number ~ '^T[0-9]{4}$'
       ) AS tray_container_assignments,
       (
         SELECT COUNT(*)::int
           FROM container_tray ct
           JOIN containers c ON c.id=ct.container_id
          WHERE ct.enabled=true
            AND c.serial_number ~ '^C[0-9]{4}$'
       ) AS container_assignments`,
  );

  for (const [name, count] of Object.entries(result ?? {})) {
    if (Number(count) !== 0) {
      throw new Error(
        `Managed T/C inventory already contains active data (${name}=${count}). ` +
          'Run this mock seed only as part of a clean full reset so real activity is never overwritten.',
      );
    }
  }

  const mockExisting = await one(
    client,
    `SELECT
       (SELECT COUNT(*)::int FROM blades WHERE serial_number LIKE $1) AS blades,
       (SELECT COUNT(*)::int FROM cutter_builds WHERE build_number LIKE $2) AS builds,
       (SELECT COUNT(*)::int FROM cutter_bodies WHERE dana_serial_number LIKE $3) AS bodies`,
    [`${MOCK_BLADE_PREFIX}%`, `${MOCK_BUILD_PREFIX}%`, `${MOCK_BODY_PREFIX}%`],
  );

  if (
    Number(mockExisting?.blades ?? 0) !== 0 ||
    Number(mockExisting?.builds ?? 0) !== 0 ||
    Number(mockExisting?.bodies ?? 0) !== 0
  ) {
    throw new Error(
      'Mock records already exist. Run the clean full reset before reseeding mock data.',
    );
  }
}

async function populateTray({
  client,
  traySerial,
  requirement,
  stageId,
  bladeStatus,
  bladeCount,
  grindingCompleted,
  requiredSnapshot,
}) {
  const tray = await one(
    client,
    `SELECT id FROM trays WHERE serial_number=$1 AND enabled=true LIMIT 1`,
    [traySerial],
  );
  if (!tray) throw new Error(`Managed tray ${traySerial} does not exist.`);

  await client.query(
    `UPDATE trays
        SET blade_count=$2,
            summary_id=$3,
            part_type_id=$4,
            grinding_completed_at=$5,
            required_blade_count=$6,
            current_stage_id=$7,
            enabled=true,
            "updatedAt"=NOW()
      WHERE id=$1`,
    [
      tray.id,
      bladeCount,
      requirement.summary_id,
      requirement.part_type_id,
      grindingCompleted ? new Date() : null,
      requiredSnapshot,
      stageId,
    ],
  );

  for (let n = 1; n <= bladeCount; n += 1) {
    const bladeId = crypto.randomUUID();
    const bladeSerial =
      `${MOCK_BLADE_PREFIX}${traySerial}-${String(n).padStart(3, '0')}`;

    await client.query(
      `INSERT INTO blades
        (
          id, "createdAt", "updatedAt",
          summary_id, serial_number, part_type_id,
          status, service_cycle, enabled
        )
       VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,0,true)`,
      [
        bladeId,
        requirement.summary_id,
        bladeSerial,
        requirement.part_type_id,
        bladeStatus,
      ],
    );

    await client.query(
      `INSERT INTO blade_tray
        (
          id, "createdAt", "updatedAt",
          tray_id, blade_id, enabled
        )
       VALUES ($1,NOW(),NOW(),$2,$3,true)`,
      [crypto.randomUUID(), tray.id, bladeId],
    );
  }

  return tray;
}

async function assignTrayToLocation(client, trayId, locationId) {
  await client.query(
    `INSERT INTO location_tray
      (
        id, "createdAt", "updatedAt",
        tray_id, location_id, enabled
      )
     VALUES ($1,NOW(),NOW(),$2,$3,true)`,
    [crypto.randomUUID(), trayId, locationId],
  );
}

async function assignTrayToContainer(client, trayId, containerSerial) {
  const container = await one(
    client,
    `SELECT id FROM containers WHERE serial_number=$1 AND enabled=true LIMIT 1`,
    [containerSerial],
  );
  if (!container) throw new Error(`Managed container ${containerSerial} does not exist.`);

  await client.query(
    `INSERT INTO container_tray
      (
        id, "createdAt", "updatedAt",
        tray_id, container_id, enabled
      )
     VALUES ($1,NOW(),NOW(),$2,$3,true)`,
    [crypto.randomUUID(), trayId, container.id],
  );
}

async function populateGreenShedShelf(client, location, requirement, shelfStatusId, index) {
  const bodyId = crypto.randomUUID();
  const bodySerial = `${MOCK_BODY_PREFIX}${String(index).padStart(3, '0')}`;
  await client.query(
    `INSERT INTO cutter_bodies
      (
        id, "createdAt", "updatedAt",
        dana_serial_number, mf_serial_number,
        definition_id, description, enabled
      )
     VALUES ($1,NOW(),NOW(),$2,NULL,NULL,$3,true)`,
    [
      bodyId,
      bodySerial,
      `Mock cutter body for ${requirement.summary_number} ${requirement.part_type_code}`,
    ],
  );

  const buildId = crypto.randomUUID();
  const buildNumber =
    `${MOCK_BUILD_PREFIX}${String(index).padStart(3, '0')}`;

  await client.query(
    `INSERT INTO cutter_builds
      (
        id, "createdAt", "updatedAt",
        build_number, build_increment, cutter_body_id,
        summary_id, part_type_id, status_id,
        honed, coated, ib_ro, ob_ro, comments,
        built_by_user_id, built_at, completed_at
      )
     VALUES
      ($1,NOW(),NOW(),$2,1,$3,$4,$5,$6,false,false,NULL,NULL,$7,NULL,NOW(),NULL)`,
    [
      buildId,
      buildNumber,
      bodyId,
      requirement.summary_id,
      requirement.part_type_id,
      shelfStatusId,
      'MOCK DATA - seeded for dashboard/location testing',
    ],
  );

  await client.query(
    `INSERT INTO cutter_build_locations
      (
        id, "createdAt", "updatedAt",
        cutter_build_id, location_id,
        placed_at, removed_at, enabled
      )
     VALUES ($1,NOW(),NOW(),$2,$3,NOW(),NULL,true)`,
    [crypto.randomUUID(), buildId, location.id],
  );
}

if (!process.argv.includes('--apply')) {
  console.log('[SAFE] T/C mock-data seed was NOT applied.');
  console.log(`[SAFE] Would create ${TRAY_COUNT} trays (${serial('T', 1)} .. ${serial('T', TRAY_COUNT)}).`);
  console.log(`[SAFE] Would create ${CONTAINER_COUNT} containers (${serial('C', 1)} .. ${serial('C', CONTAINER_COUNT)}).`);
  console.log('[SAFE] Would populate tray-compatible locations with mixed Summary / RING / PINION mock inventory.');
  console.log('[SAFE] Would populate Green Shed cutter shelves with mock cutter builds, because trays are not allowed on Green Shed shelves.');
  process.exit(0);
}

const env = {
  ...loadDotEnv(path.resolve(projectRoot, '..', '.env')),
  ...process.env,
};

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

await client.connect();

try {
  await client.query('BEGIN');

  const stagesResult = await client.query(
    `SELECT id, code
       FROM tray_stages
      WHERE code IN ('EMPTY','WAITING_FOR_GRINDING','READY_FOR_CUTTER','AT_COATER')
        AND enabled=true`,
  );
  const stages = new Map(stagesResult.rows.map((row) => [row.code, row.id]));
  for (const required of [
    'EMPTY',
    'WAITING_FOR_GRINDING',
    'READY_FOR_CUTTER',
    'AT_COATER',
  ]) {
    if (!stages.has(required)) {
      throw new Error(`${required} tray stage is not configured.`);
    }
  }

  const shelfStatus = await one(
    client,
    `SELECT id FROM cutter_build_statuses WHERE code='SHELF' AND enabled=true LIMIT 1`,
  );
  if (!shelfStatus) {
    throw new Error('SHELF cutter-build status is not configured.');
  }

  const requirementsResult = await client.query(
    `SELECT
       r.summary_id,
       r.part_type_id,
       r.required_blade_count,
       s.number AS summary_number,
       s.revision AS summary_revision,
       pt.code AS part_type_code
     FROM cutter_blade_requirements r
     JOIN part_summaries s ON s.id=r.summary_id
     JOIN part_types pt ON pt.id=r.part_type_id
    WHERE r.enabled=true
      AND s.enabled=true
      AND s.active=true
      AND pt.enabled=true
      AND pt.code IN ('RING','PINION')
    ORDER BY s.number, pt.code`,
  );

  const requirements = roundRobinRequirements(
    requirementsResult.rows.filter((row) => isShelfSummary(row.summary_number)),
  );

  if (requirements.length < 2) {
    throw new Error(
      'At least two enabled RING/PINION Summary requirements are required to seed mixed mock data.',
    );
  }

  await ensurePhysicalInventory(client, stages.get('EMPTY'));
  await assertManagedInventoryIsUnused(client);

  const selected = requirements.slice(
    0,
    Math.min(MOCK_SUMMARY_SETS, requirements.length),
  );

  // Create the normal Summary shelf convention for a useful mock set. Green Shed shelves are part-type-specific.
  for (const requirement of selected) {
    const summary = normalizeSummary(requirement.summary_number);
    const cuttergrindPartLetter =
      requirement.part_type_code === 'RING' ? 'R' : 'P';
    await ensureLocation(
      client,
      `CGD${cuttergrindPartLetter}-${summary}`,
      summary,
      `Mock Cutter Grind dull ${requirement.part_type_code} shelf for ${summary}`,
      'CUTTERGRIND',
      'SHELF',
    );
    await ensureLocation(
      client,
      `CGF${cuttergrindPartLetter}-${summary}`,
      summary,
      `Mock Cutter Grind finished ${requirement.part_type_code} shelf for ${summary}`,
      'CUTTERGRIND',
      'SHELF',
    );
    const greenShedPrefix =
      requirement.part_type_code === 'RING' ? 'GSR-' : 'GSP-';
    await ensureLocation(
      client,
      `${greenShedPrefix}${summary}`,
      summary,
      `Mock Green Shed ${requirement.part_type_code} cutter shelf for ${summary}`,
      'GREENSHED',
      'SHELF',
    );
  }

  const locationsResult = await client.query(
    `SELECT id, serial_number, number, description, department, location_type
       FROM locations
      WHERE enabled=true
      ORDER BY serial_number`,
  );

  const greenShedShelves = [];
  const trayLocations = [];

  for (const location of locationsResult.rows) {
    const department = String(location.department ?? '').trim().toUpperCase();
    const isGreenShedShelf =
      location.location_type === 'SHELF' &&
      department === 'GREENSHED';

    if (isGreenShedShelf) greenShedShelves.push(location);
    else trayLocations.push(location);
  }

  // Ensure every tray-compatible location has at least one mock populated tray.
  let nextTrayNumber = 1;
  let genericRequirementIndex = 0;
  let locationSeededCount = 0;

  for (const location of trayLocations) {
    if (nextTrayNumber > TRAY_COUNT - MOCK_CONTAINER_LOADS) {
      throw new Error(
        `There are ${trayLocations.length} tray-compatible locations but only ${TRAY_COUNT - MOCK_CONTAINER_LOADS} trays are reserved for locations.`,
      );
    }

    const locationSerial = String(location.serial_number ?? '').trim().toUpperCase();

    let requirement;
    let stageCode = 'WAITING_FOR_GRINDING';
    let bladeStatus = 'waiting_for_grinding';
    let complete = false;

    if (/^CGD[RP]-/.test(locationSerial)) {
      const partTypeCode = locationSerial.startsWith('CGDR-') ? 'RING' : 'PINION';
      const summary = locationSerial.slice(5);
      requirement =
        requirements.find(
          (row) =>
            normalizeSummary(row.summary_number) === summary &&
            row.part_type_code === partTypeCode,
        ) ?? null;
      stageCode = 'WAITING_FOR_GRINDING';
      bladeStatus = 'waiting_for_grinding';
    } else if (/^CGF[RP]-/.test(locationSerial)) {
      const partTypeCode = locationSerial.startsWith('CGFR-') ? 'RING' : 'PINION';
      const summary = locationSerial.slice(5);
      requirement =
        requirements.find(
          (row) =>
            normalizeSummary(row.summary_number) === summary &&
            row.part_type_code === partTypeCode,
        ) ?? null;
      stageCode = 'READY_FOR_CUTTER';
      bladeStatus = 'returned_from_coating';
      complete = true;
    } else {
      requirement = requirements[genericRequirementIndex % requirements.length];
      genericRequirementIndex += 1;
    }

    // A summary shelf without matching live reference data is not safe to fake.
    if (!requirement) {
      console.log(
        `[SKIP] ${location.serial_number}: no enabled RING/PINION requirement exists for shelf Summary ${location.number}.`,
      );
      continue;
    }

    const requiredCount = Number(requirement.required_blade_count);
    const bladeCount = complete
      ? requiredCount
      : Math.max(1, Math.min(requiredCount, Math.max(3, Math.ceil(requiredCount / 2))));

    const traySerial = serial(TRAY_PREFIX, nextTrayNumber);
    nextTrayNumber += 1;

    const tray = await populateTray({
      client,
      traySerial,
      requirement,
      stageId: stages.get(stageCode),
      bladeStatus,
      bladeCount,
      grindingCompleted: complete,
      requiredSnapshot: complete ? requiredCount : null,
    });

    await assignTrayToLocation(client, tray.id, location.id);
    locationSeededCount += 1;
  }

  // Green Shed shelves are cutter shelves: populate them with mock cutter builds,
  // not trays, matching the production business rule.
  let shelfBuildCount = 0;
  for (let index = 0; index < greenShedShelves.length; index += 1) {
    const location = greenShedShelves[index];
    const summary = normalizeSummary(location.number);
    const locationSerial = String(location.serial_number ?? '').trim().toUpperCase();
    const shelfPartType = locationSerial.startsWith('GSR-')
      ? 'RING'
      : locationSerial.startsWith('GSP-')
        ? 'PINION'
        : null;
    if (!shelfPartType) {
      console.log(
        `[SKIP] ${location.serial_number}: legacy/invalid Green Shed shelf tag. Use GSR-<summary> for RING or GSP-<summary> for PINION.`,
      );
      continue;
    }

    const matching = requirements.filter(
      (row) =>
        normalizeSummary(row.summary_number) === summary &&
        row.part_type_code === shelfPartType,
    );
    if (!matching.length) {
      console.log(
        `[SKIP] ${location.serial_number}: no enabled ${shelfPartType} requirement exists for Green Shed shelf Summary ${summary}.`,
      );
      continue;
    }

    const requirement = matching[0];
    await populateGreenShedShelf(
      client,
      location,
      requirement,
      shelfStatus.id,
      index + 1,
    );
    shelfBuildCount += 1;
  }

  // Put a small mixed sample at the coater as well.
  const containerLoads = Math.min(
    MOCK_CONTAINER_LOADS,
    requirements.length,
    TRAY_COUNT - nextTrayNumber + 1,
  );

  for (let index = 0; index < containerLoads; index += 1) {
    const requirement = requirements[index % requirements.length];
    const requiredCount = Number(requirement.required_blade_count);
    const traySerial = serial(TRAY_PREFIX, nextTrayNumber);
    nextTrayNumber += 1;

    const tray = await populateTray({
      client,
      traySerial,
      requirement,
      stageId: stages.get('AT_COATER'),
      bladeStatus: 'at_coater',
      bladeCount: requiredCount,
      grindingCompleted: true,
      requiredSnapshot: requiredCount,
    });

    await assignTrayToContainer(
      client,
      tray.id,
      serial(CONTAINER_PREFIX, index + 1),
    );
  }

  const verification = await one(
    client,
    `SELECT
       (SELECT COUNT(*)::int
          FROM trays
         WHERE serial_number ~ '^T[0-9]{4}$'
           AND substring(serial_number from 2)::int BETWEEN 1 AND $1) AS trays,
       (SELECT COUNT(*)::int
          FROM containers
         WHERE serial_number ~ '^C[0-9]{4}$'
           AND substring(serial_number from 2)::int BETWEEN 1 AND $2) AS containers,
       (SELECT COUNT(*)::int
          FROM location_tray lt
          JOIN trays t ON t.id=lt.tray_id
         WHERE lt.enabled=true
           AND t.serial_number ~ '^T[0-9]{4}$') AS trays_at_locations,
       (SELECT COUNT(*)::int
          FROM container_tray ct
          JOIN containers c ON c.id=ct.container_id
         WHERE ct.enabled=true
           AND c.serial_number ~ '^C[0-9]{4}$') AS loaded_containers,
       (SELECT COUNT(DISTINCT t.summary_id)::int
          FROM trays t
         WHERE t.serial_number ~ '^T[0-9]{4}$'
           AND t.summary_id IS NOT NULL) AS distinct_summaries,
       (SELECT COUNT(DISTINCT pt.code)::int
          FROM trays t
          JOIN part_types pt ON pt.id=t.part_type_id
         WHERE t.serial_number ~ '^T[0-9]{4}$'
           AND t.part_type_id IS NOT NULL) AS distinct_part_types,
       (SELECT COUNT(*)::int
          FROM cutter_build_locations cbl
          JOIN cutter_builds cb ON cb.id=cbl.cutter_build_id
         WHERE cbl.enabled=true
           AND cb.build_number LIKE $3) AS mock_shelf_builds`,
    [TRAY_COUNT, CONTAINER_COUNT, `${MOCK_BUILD_PREFIX}%`],
  );

  if (Number(verification.trays) !== TRAY_COUNT) {
    throw new Error(`Expected ${TRAY_COUNT} managed trays; found ${verification.trays}.`);
  }
  if (Number(verification.containers) !== CONTAINER_COUNT) {
    throw new Error(
      `Expected ${CONTAINER_COUNT} managed containers; found ${verification.containers}.`,
    );
  }
  if (Number(verification.trays_at_locations) !== locationSeededCount) {
    throw new Error(
      `Expected ${locationSeededCount} mock trays at locations; found ${verification.trays_at_locations}.`,
    );
  }
  if (Number(verification.loaded_containers) !== containerLoads) {
    throw new Error(
      `Expected ${containerLoads} mock loaded containers; found ${verification.loaded_containers}.`,
    );
  }
  if (Number(verification.distinct_summaries) < Math.min(2, requirements.length)) {
    throw new Error('Mock tray data did not include multiple Summaries.');
  }
  if (
    requirements.some((row) => row.part_type_code === 'RING') &&
    requirements.some((row) => row.part_type_code === 'PINION') &&
    Number(verification.distinct_part_types) < 2
  ) {
    throw new Error('Mock tray data did not include both RING and PINION.');
  }
  if (Number(verification.mock_shelf_builds) !== shelfBuildCount) {
    throw new Error(
      `Expected ${shelfBuildCount} mock Green Shed shelf builds; found ${verification.mock_shelf_builds}.`,
    );
  }

  await client.query('COMMIT');

  console.log(
    `[PASS] Created ${TRAY_COUNT} reusable trays (${serial('T', 1)} .. ${serial('T', TRAY_COUNT)}).`,
  );
  console.log(
    `[PASS] Created ${CONTAINER_COUNT} reusable containers (${serial('C', 1)} .. ${serial('C', CONTAINER_COUNT)}).`,
  );
  console.log(
    `[PASS] Seeded ${locationSeededCount} tray-compatible locations with mock populated trays.`,
  );
  console.log(
    `[PASS] Seeded ${shelfBuildCount} Green Shed cutter shelves with mock cutter builds (trays are intentionally not allowed there).`,
  );
  console.log(
    `[PASS] Loaded ${containerLoads} mock trays into ${containerLoads} containers for Coater-state testing.`,
  );
  console.log(
    `[PASS] Mock inventory spans ${verification.distinct_summaries} Summaries and ${verification.distinct_part_types} Part Types.`,
  );
  console.log(
    `[PASS] Remaining managed T/C records stay empty and available for normal workflow testing.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
