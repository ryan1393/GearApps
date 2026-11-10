import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { assertTestAccountsAllowed } from './test-account-guard.mjs';

const { Client } = pg;

const AUTO_TEST_EMAIL = 'test@gearapps.local';
const E2E_CUTTERGRIND_SHELF_NUMBER = '990';
const AUTO_TEST_PASSWORD = 'GearApps-E2E-Only-2026!';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function loadDotEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function normalizeSummaryNumber(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function serialStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

async function one(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] ?? null;
}

async function ensureShelf(client, serial, number, department, description) {
  const existing = await one(
    client,
    `select id, serial_number, number, department, location_type, enabled
       from locations
      where upper(serial_number) = upper($1)
      limit 1`,
    [serial],
  );

  if (existing) {
    const valid =
      existing.enabled === true &&
      existing.number === number &&
      existing.department === department &&
      existing.location_type === 'SHELF';

    if (!valid) {
      throw new Error(
        `Existing location ${serial} does not match the required test convention ` +
          `(number=${number}, department=${department}, type=SHELF, enabled=true).`,
      );
    }
    return { ...existing, created: false };
  }

  const id = crypto.randomUUID();
  await client.query(
    `insert into locations
      (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
       serial_number, number, description, department, location_type, enabled)
     values ($1, now(), now(), null, null, $2, $3, $4, $5, 'SHELF', true)`,
    [id, serial, number, description, department],
  );
  return {
    id,
    serial_number: serial,
    number,
    department,
    location_type: 'SHELF',
    enabled: true,
    created: true,
  };
}

async function ensureInternalLocation(client, serial, number, description) {
  const existing = await one(
    client,
    `select id, serial_number, number, department, location_type, enabled
       from locations
      where upper(serial_number) = upper($1)
      limit 1`,
    [serial],
  );

  if (existing) {
    const valid =
      existing.enabled === true &&
      existing.number === number &&
      existing.location_type === 'INTERNAL';

    if (!valid) {
      throw new Error(
        `Existing location ${serial} conflicts with the required Blade Tracking test location.`,
      );
    }
    return { ...existing, created: false };
  }

  const id = crypto.randomUUID();
  await client.query(
    `insert into locations
      (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
       serial_number, number, description, department, location_type, enabled)
     values ($1, now(), now(), null, null, $2, $3, $4, null, 'INTERNAL', true)`,
    [id, serial, number, description],
  );

  return {
    id,
    serial_number: serial,
    number,
    department: null,
    location_type: 'INTERNAL',
    enabled: true,
    created: true,
  };
}

async function ensureEmptyTray(client, emptyStageId, prefix) {
  let tray = await one(
    client,
    `select t.id, t.serial_number, t.blade_count
       from trays t
       join tray_stages st on st.id = t.current_stage_id
      where t.enabled = true
        and t.serial_number like $1
        and st.code = 'EMPTY'
        and t.blade_count = 0
        and not exists (
          select 1 from blade_tray bt where bt.tray_id = t.id and bt.enabled = true
        )
        and not exists (
          select 1 from container_tray ct where ct.tray_id = t.id and ct.enabled = true
        )
      order by t."createdAt" desc
      limit 1`,
    [`${prefix}%`],
  );

  if (tray) return { ...tray, created: false };

  const trayId = crypto.randomUUID();
  const traySerial = `${prefix}${serialStamp()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  await client.query(
    `insert into trays
      (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
       serial_number, blade_count, summary_id, part_type_id,
       grinding_completed_at, required_blade_count, current_stage_id, enabled)
     values ($1, now(), now(), null, null, $2, 0, null, null, null, null, $3, true)`,
    [trayId, traySerial, emptyStageId],
  );

  return { id: trayId, serial_number: traySerial, blade_count: 0, created: true };
}

async function ensureEmptyContainer(client) {
  let container = await one(
    client,
    `select c.id, c.serial_number
       from containers c
      where c.enabled = true
        and c.serial_number like 'E2E-CONTAINER-%'
        and not exists (
          select 1 from container_tray ct
           where ct.container_id = c.id and ct.enabled = true
        )
      order by c."createdAt" desc
      limit 1`,
  );

  if (container) return { ...container, created: false };

  const id = crypto.randomUUID();
  const serial = `E2E-CONTAINER-${serialStamp()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  await client.query(
    `insert into containers
      (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
       serial_number, enabled)
     values ($1, now(), now(), null, null, $2, true)`,
    [id, serial],
  );

  return { id, serial_number: serial, created: true };
}

async function ensureBladeTrackingReferenceFixture(client) {
  const summaryNumber = 'E2E-BLADE-TEST';
  const summaryRevision = 'TEST';
  const partTypeCode = 'E2E';
  const requiredBladeCount = 11;

  let summary = await one(
    client,
    `select id, number, revision, active, enabled
       from part_summaries
      where number = $1 and revision = $2
      limit 1`,
    [summaryNumber, summaryRevision],
  );

  if (!summary) {
    const id = crypto.randomUUID();
    await client.query(
      `insert into part_summaries
        (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
         number, revision, model_id, hos, active, enabled)
       values ($1, now(), now(), null, null, $2, $3, null, null, true, true)`,
      [id, summaryNumber, summaryRevision],
    );
    summary = {
      id,
      number: summaryNumber,
      revision: summaryRevision,
      active: true,
      enabled: true,
    };
  } else if (!summary.active || !summary.enabled) {
    throw new Error(
      `Existing fake summary ${summaryNumber}/${summaryRevision} is disabled. ` +
        'Enable or remove it before provisioning Blade Tracking test data.',
    );
  }

  let partType = await one(
    client,
    `select id, code, name, enabled
       from part_types
      where code = $1
      limit 1`,
    [partTypeCode],
  );

  if (!partType) {
    const id = crypto.randomUUID();
    await client.query(
      `insert into part_types
        (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
         code, name, description, sort_order, enabled)
       values ($1, now(), now(), null, null, $2, $3, $4, 9999, true)`,
      [
        id,
        partTypeCode,
        'E2E Test',
        'Dedicated Blade Tracking automated test part type',
      ],
    );
    partType = {
      id,
      code: partTypeCode,
      name: 'E2E Test',
      enabled: true,
    };
  } else if (!partType.enabled) {
    throw new Error(
      `Existing fake part type ${partTypeCode} is disabled. ` +
        'Enable or remove it before provisioning Blade Tracking test data.',
    );
  }

  let requirement = await one(
    client,
    `select id, summary_id, part_type_id, required_blade_count, enabled
       from cutter_blade_requirements
      where summary_id = $1 and part_type_id = $2
      limit 1`,
    [summary.id, partType.id],
  );

  if (!requirement) {
    const id = crypto.randomUUID();
    await client.query(
      `insert into cutter_blade_requirements
        (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
         summary_id, part_type_id, required_blade_count, enabled)
       values ($1, now(), now(), null, null, $2, $3, $4, true)`,
      [id, summary.id, partType.id, requiredBladeCount],
    );
    requirement = {
      id,
      summary_id: summary.id,
      part_type_id: partType.id,
      required_blade_count: requiredBladeCount,
      enabled: true,
    };
  } else if (!requirement.enabled) {
    throw new Error(
      'Existing E2E Blade Tracking blade requirement is disabled. ' +
        'Enable or remove it before provisioning test data.',
    );
  }

  return {
    summary_id: summary.id,
    part_type_id: partType.id,
    required_blade_count: Number(requirement.required_blade_count),
    summary_number: summary.number,
    part_type_code: partType.code,
    reference_fixture_created_or_reused: true,
  };
}


async function ensureAutomaticTestUser(client) {
  const passwordHash = await bcrypt.hash(AUTO_TEST_PASSWORD, 10);
  const existing = await one(
    client,
    `select id from users where lower(email) = lower($1) limit 1`,
    [AUTO_TEST_EMAIL],
  );

  if (existing) {
    await client.query(
      `update users
          set password = $2,
              active = true,
              "isEmailVerified" = true,
              "emailVerifiedOn" = coalesce("emailVerifiedOn", now()),
              "updatedAt" = now()
        where id = $1`,
      [existing.id, passwordHash],
    );
    return existing.id;
  }

  const id = crypto.randomUUID();
  await client.query(
    `insert into users
      (id, "createdAt", "updatedAt", email, password, "firstName", "lastName",
       role, active, "isEmailVerified", "emailVerifiedOn", "socialProvider")
     values
      ($1, now(), now(), $2, $3, 'Gear Apps', 'E2E Test', 'user', true, true, now(), 'email')`,
    [id, AUTO_TEST_EMAIL, passwordHash],
  );
  return id;
}

async function ensureE2EMachine(client, partTypeCode) {
  const normalizedType = String(partTypeCode ?? '').trim().toUpperCase();
  const departmentDescription =
    normalizedType === 'PINION' ? 'PINION CUTTING' :
    normalizedType === 'RING' ? 'GEAR CUTTING' : null;
  if (!departmentDescription) throw new Error(`Unsupported workflow part type ${normalizedType}.`);

  const department = await one(
    client,
    `select id from departments where upper(description)=upper($1) and enabled=true limit 1`,
    [departmentDescription],
  );
  if (!department) throw new Error(`${departmentDescription} department is not configured.`);

  const prefix = normalizedType === 'PINION' ? 'E2E-PINION-MACHINE-' : 'E2E-RING-MACHINE-';
  const existing = await one(
    client,
    `select id, machine_number
       from machines
      where machine_number like $1
        and department_id=$2
        and enabled=true
      order by "createdAt" desc
      limit 1`,
    [`${prefix}%`, department.id],
  );
  if (existing) {
    const busy = await one(
      client,
      `select id from cutter_machine_runs where machine_id=$1 and enabled=true limit 1`,
      [existing.id],
    );
    if (!busy) {
      await client.query(`update machines set active=true, "updatedAt"=now() where id=$1`, [existing.id]);
      return { ...existing, part_type_code: normalizedType, created: false };
    }
  }

  const id = crypto.randomUUID();
  const machineNumber = `${prefix}${serialStamp()}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
  await client.query(
    `insert into machines
      (id, "createdAt", "updatedAt", machine_number, department_id, cell, active, description, enabled)
     values ($1, now(), now(), $2, $3, null, true, $4, true)`,
    [id, machineNumber, department.id, `Dedicated automated ${normalizedType} Gear Apps workflow test machine`],
  );
  return { id, machine_number: machineNumber, part_type_code: normalizedType, created: true };
}

// Cutter builds must record which Department 45 Cutter Builder machine built them.
async function ensureE2ECutterBuilderMachine(client) {
  const machineNumber = 'E2E-CUTTER-BUILDER';
  const department = await one(client, `select id from departments where code='45' and enabled=true limit 1`);
  if (!department) throw new Error('Department 45 is required for the E2E Cutter Builder machine.');
  const existing = await one(client, `select id, machine_number from machines where machine_number=$1 limit 1`, [machineNumber]);
  if (existing) {
    await client.query(
      `update machines set enabled=true, active=true, machine_type='CUTTER_BUILDER', department_id=$2, "updatedAt"=now() where id=$1`,
      [existing.id, department.id],
    );
    return { id: existing.id, machine_number: machineNumber, created: false };
  }
  const id = crypto.randomUUID();
  await client.query(
    `insert into machines
      (id, "createdAt", "updatedAt", machine_number, department_id, cell, active, description, machine_type, enabled)
     values ($1, now(), now(), $2, $3, null, true, 'Dedicated automated Gear Apps Cutter Builder test machine', 'CUTTER_BUILDER', true)`,
    [id, machineNumber, department.id],
  );
  return { id, machine_number: machineNumber, created: true };
}

async function ensureE2ECutterBody(client, count) {
  const size = new Map([[11, '064'], [13, '076'], [17, '088'], [19, '105']]).get(count);
  if (!size) throw new Error(`Workflow fixture requires a supported cutter capacity, got ${count}`);
  const prefix = `E2E-MF-WORKFLOW-${size}-`;

  const existing = await one(
    client,
    `select cb.id, cb.dana_serial_number, cb.mf_serial_number
       from cutter_bodies cb
      where cb.enabled=true
        and cb.mf_serial_number like $1
        and not exists (
          select 1 from cutter_builds b
           where b.cutter_body_id=cb.id
             and b.completed_at is null
        )
      order by cb."createdAt" desc
      limit 1`,
    [`${prefix}%`],
  );
  if (existing) {
    return {
      id: existing.id,
      serial_number: existing.dana_serial_number || existing.mf_serial_number,
      created: false,
    };
  }

  const id = crypto.randomUUID();
  const mf = `${prefix}${serialStamp()}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
  await client.query(
    `insert into cutter_bodies
      (id, "createdAt", "updatedAt", dana_serial_number, mf_serial_number, definition_id, description, enabled)
     values ($1, now(), now(), null, $2, null, 'Dedicated automated Gear Apps workflow test cutter', true)`,
    [id, mf],
  );
  return { id, serial_number: mf, created: true };
}

async function ensureE2EPart(client, summaryId, partTypeId) {
  const existing = await one(
    client,
    `select id, part_number
       from parts
      where summary_id=$1
        and part_type_id=$2
        and active=true
        and enabled=true
        and part_number like 'E2E-PART-%'
      order by "createdAt" desc
      limit 1`,
    [summaryId, partTypeId],
  );
  if (existing) return { ...existing, created: false };

  const id = crypto.randomUUID();
  const partNumber = `E2E-PART-${serialStamp()}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
  await client.query(
    `insert into parts
      (id, "createdAt", "updatedAt", part_number, summary_id, part_type_id, teeth, active, enabled)
     values ($1, now(), now(), $2, $3, $4, null, true, true)`,
    [id, partNumber, summaryId, partTypeId],
  );
  return { id, part_number: partNumber, created: true };
}

async function ensureOppositeE2EPart(client, summaryId, partTypeCode) {
  const oppositeCode = String(partTypeCode).toUpperCase() === 'PINION' ? 'RING' : 'PINION';
  const oppositeType = await one(
    client,
    `select id from part_types where upper(code)=upper($1) and enabled=true limit 1`,
    [oppositeCode],
  );
  if (!oppositeType) throw new Error(`${oppositeCode} part type is not configured.`);
  return {
    ...(await ensureE2EPart(client, summaryId, oppositeType.id)),
    part_type_code: oppositeCode,
  };
}

async function selectWorkflowPullReasons(client) {
  const changeover = await one(
    client,
    `select code from cutter_pull_reasons
      where enabled=true and requires_teardown=false and returns_to_shelf=true
      order by case when upper(code)='CHANGEOVER' then 0 else 1 end, sort_order, code
      limit 1`,
  );
  const teardown = await one(
    client,
    `select code from cutter_pull_reasons
      where enabled=true and requires_teardown=true and returns_to_shelf=false
      order by sort_order, code
      limit 1`,
  );
  if (!changeover) throw new Error('No enabled changeover/shelf-return pull reason is configured.');
  if (!teardown) throw new Error('No enabled teardown-required pull reason is configured.');
  return { changeover: changeover.code, teardown: teardown.code };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // fileURLToPath is required on Windows. Using URL.pathname directly turns
  // C:\... into /C:/..., which caused the fixture script to miss the project
  // .env file and pass an undefined password to node-postgres.
  const scriptFile = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptFile);
  const projectRoot = path.resolve(scriptDir, '..', '..');

  const dotEnvPath = path.resolve(projectRoot, '..', '.env');
  const fileEnv = loadDotEnv(dotEnvPath);
  const env = {
    ...fileEnv,
    ...process.env,
  };

  const requiredDatabaseSettings = [
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_USERNAME',
    'DATABASE_PASSWORD',
    'DATABASE_NAME',
  ];

  const missingDatabaseSettings = requiredDatabaseSettings.filter(
    (key) => typeof env[key] !== 'string' || env[key].length === 0,
  );

  if (missingDatabaseSettings.length > 0) {
    throw new Error(
      `Database configuration missing: ${missingDatabaseSettings.join(', ')}. ` +
        `Expected values in ${dotEnvPath}.`,
    );
  }

  const databasePort = Number(env.DATABASE_PORT);
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error(`DATABASE_PORT must be a valid TCP port; received '${env.DATABASE_PORT}'.`);
  }

  assertTestAccountsAllowed(env, 'ensure-workflow-test-fixtures');
  const client = new Client({
    host: String(env.DATABASE_HOST),
    port: databasePort,
    user: String(env.DATABASE_USERNAME),
    password: String(env.DATABASE_PASSWORD),
    database: String(env.DATABASE_NAME),
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to PostgreSQL at ${env.DATABASE_HOST}:${databasePort}/${env.DATABASE_NAME}: ` +
        `${error.message}`,
    );
  }

  try {
    await client.query('begin');

    let requirement;
    const summaryId = args.summaryId || null;
    const partTypeId = args.partTypeId || null;

    if ((summaryId && !partTypeId) || (!summaryId && partTypeId)) {
      throw new Error('summaryId and partTypeId must be supplied together, or both omitted.');
    }

    if (summaryId && partTypeId) {
      requirement = await one(
        client,
        `select r.summary_id, r.part_type_id, r.required_blade_count,
                s.number as summary_number, pt.code as part_type_code
           from cutter_blade_requirements r
           join part_summaries s on s.id = r.summary_id
           join part_types pt on pt.id = r.part_type_id
          where r.summary_id = $1
            and r.part_type_id = $2
            and r.enabled = true
            and s.enabled = true
            and s.active = true
            and pt.enabled = true
          limit 1`,
        [summaryId, partTypeId],
      );
    } else {
      requirement = await one(
        client,
        `select r.summary_id, r.part_type_id, r.required_blade_count,
                s.number as summary_number, pt.code as part_type_code
           from cutter_blade_requirements r
           join part_summaries s on s.id = r.summary_id
           join part_types pt on pt.id = r.part_type_id
          where r.enabled = true
            and s.enabled = true
            and s.active = true
            and pt.enabled = true
            and r.required_blade_count > 0
          order by s.number, pt.code
          limit 1`,
      );
    }

    let referenceFixtureUsed = false;

    if (!requirement && args.allowFakeReferenceData) {
      requirement = await ensureBladeTrackingReferenceFixture(client);
      referenceFixtureUsed = true;
    }

    if (!requirement) {
      throw new Error(
        'No enabled cutter blade requirement is available for the full workflow. ' +
          'Import/configure production-like summary, part type, and blade requirement data first, ' +
          'or run npm run test:blade-data to create dedicated Blade Tracking E2E reference data.',
      );
    }

    const summaryNumber = normalizeSummaryNumber(requirement.summary_number);
    if (!summaryNumber) throw new Error('Selected summary has an empty summary number.');

    const waitingStage = await one(
      client,
      `select id from tray_stages where code = 'WAITING_FOR_GRINDING' and enabled = true limit 1`,
    );
    const emptyStage = await one(
      client,
      `select id from tray_stages where code = 'EMPTY' and enabled = true limit 1`,
    );
    if (!waitingStage || !emptyStage) {
      throw new Error('WAITING_FOR_GRINDING and EMPTY tray stages must be configured.');
    }

    const requiredBladeCount = Number(requirement.required_blade_count);
    if (!Number.isInteger(requiredBladeCount) || requiredBladeCount <= 0) {
      throw new Error(`Invalid required blade count: ${requirement.required_blade_count}`);
    }

    let sourceTray = await one(
      client,
      `select t.id, t.serial_number, t.blade_count
         from trays t
         join tray_stages st on st.id = t.current_stage_id
        where t.enabled = true
          and t.serial_number like 'E2E-SOURCE-%'
          and t.summary_id = $1
          and t.part_type_id = $2
          and t.grinding_completed_at is null
          and st.code = 'WAITING_FOR_GRINDING'
          and t.blade_count = $3
          and (
            select count(*)::int
              from blade_tray bt
              join blades b on b.id = bt.blade_id
             where bt.tray_id = t.id
               and bt.enabled = true
               and b.enabled = true
               and b.status = 'waiting_for_grinding'
          ) = $3
        order by t."createdAt" desc
        limit 1`,
      [requirement.summary_id, requirement.part_type_id, requiredBladeCount],
    );

    let sourceCreated = false;
    if (!sourceTray) {
      sourceCreated = true;
      const trayId = crypto.randomUUID();
      const traySerial = `E2E-SOURCE-${summaryNumber}-${serialStamp()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

      await client.query(
        `insert into trays
          (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
           serial_number, blade_count, summary_id, part_type_id,
           grinding_completed_at, required_blade_count, current_stage_id, enabled)
         values ($1, now(), now(), null, null, $2, $3, $4, $5, null, null, $6, true)`,
        [
          trayId,
          traySerial,
          requiredBladeCount,
          requirement.summary_id,
          requirement.part_type_id,
          waitingStage.id,
        ],
      );

      for (let i = 0; i < requiredBladeCount; i += 1) {
        const bladeId = crypto.randomUUID();
        const bladeSerial =
          `E2E-BLADE-${summaryNumber}-${serialStamp()}-${String(i + 1).padStart(3, '0')}-` +
          crypto.randomUUID().slice(0, 6).toUpperCase();

        await client.query(
          `insert into blades
            (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
             summary_id, serial_number, part_type_id, status, service_cycle, enabled)
           values ($1, now(), now(), null, null, $2, $3, $4, 'waiting_for_grinding', 0, true)`,
          [bladeId, requirement.summary_id, bladeSerial, requirement.part_type_id],
        );

        await client.query(
          `insert into blade_tray
            (id, "createdAt", "updatedAt", "createdBy", "updatedBy",
             tray_id, blade_id, enabled)
           values ($1, now(), now(), null, null, $2, $3, true)`,
          [crypto.randomUUID(), trayId, bladeId],
        );
      }

      sourceTray = {
        id: trayId,
        serial_number: traySerial,
        blade_count: requiredBladeCount,
      };
    }

    const teardownTray = await ensureEmptyTray(
      client,
      emptyStage.id,
      'E2E-TEARDOWN-',
    );

    // Blade Tracking UI/demo fixtures. These are deliberately separate from the
    // destructive end-to-end source/teardown trays so the operator always has
    // something safe to scan in Intake and Internal Movement.
    const intakeTray = await ensureEmptyTray(
      client,
      emptyStage.id,
      'E2E-INTAKE-',
    );

    const coatingContainer = await ensureEmptyContainer(client);

    const internalLocations = {
      a: await ensureInternalLocation(
        client,
        'E2E-BT-LOC-A',
        'E2E-A',
        'Automated Blade Tracking internal movement test location A',
      ),
      b: await ensureInternalLocation(
        client,
        'E2E-BT-LOC-B',
        'E2E-B',
        'Automated Blade Tracking internal movement test location B',
      ),
    };

    const automaticTestUserId = await ensureAutomaticTestUser(client);
    const workflowMachine = await ensureE2EMachine(client, requirement.part_type_code);
    const cutterBuilderMachine = await ensureE2ECutterBuilderMachine(client);
    const oppositeMachine = await ensureE2EMachine(
      client,
      requirement.part_type_code === 'PINION' ? 'RING' : 'PINION',
    );
    const workflowCutterBody = await ensureE2ECutterBody(client, requiredBladeCount);
    const workflowPart = await ensureE2EPart(
      client,
      requirement.summary_id,
      requirement.part_type_id,
    );
    const oppositePart = await ensureOppositeE2EPart(
      client,
      requirement.summary_id,
      requirement.part_type_code,
    );
    const workflowPullReasons = await selectWorkflowPullReasons(client);

    const shelves = {
      greenshed: await ensureShelf(
        client,
        `${requirement.part_type_code === 'RING' ? 'GSR-' : 'GSP-'}${summaryNumber}`,
        summaryNumber,
        'GREENSHED',
        `Automated E2E Green Shed ${requirement.part_type_code} shelf for summary ${summaryNumber}`,
      ),
      // Cuttergrind shelves are numbered (CGRR/CGRP rough, CGDR/CGDP dull, CGFR/CGFP
      // finished). E2E uses shelf 990 so it never collides with a real shop shelf.
      rough: await ensureShelf(
        client,
        `CGR${requirement.part_type_code === 'RING' ? 'R' : 'P'}-${E2E_CUTTERGRIND_SHELF_NUMBER}`,
        E2E_CUTTERGRIND_SHELF_NUMBER,
        'CUTTERGRIND',
        `Automated E2E Cuttergrind rough ${requirement.part_type_code} shelf`,
      ),
      dull: await ensureShelf(
        client,
        `CGD${requirement.part_type_code === 'RING' ? 'R' : 'P'}-${E2E_CUTTERGRIND_SHELF_NUMBER}`,
        E2E_CUTTERGRIND_SHELF_NUMBER,
        'CUTTERGRIND',
        `Automated E2E Cuttergrind dull ${requirement.part_type_code} shelf`,
      ),
      finished: await ensureShelf(
        client,
        `CGF${requirement.part_type_code === 'RING' ? 'R' : 'P'}-${E2E_CUTTERGRIND_SHELF_NUMBER}`,
        E2E_CUTTERGRIND_SHELF_NUMBER,
        'CUTTERGRIND',
        `Automated E2E Cuttergrind finished ${requirement.part_type_code} shelf`,
      ),
    };

    await client.query('commit');

    process.stdout.write(
      JSON.stringify({
        ok: true,
        summary_id: requirement.summary_id,
        summary_number: summaryNumber,
        part_type_id: requirement.part_type_id,
        part_type_code: requirement.part_type_code,
        required_blade_count: requiredBladeCount,
        reference_fixture_used: referenceFixtureUsed,
        test_email: AUTO_TEST_EMAIL,
        test_password: AUTO_TEST_PASSWORD,
        test_user_id: automaticTestUserId,
        cutter_builder_machine_id: cutterBuilderMachine.id,
        cutter_builder_machine_number: cutterBuilderMachine.machine_number,
        machine_number: workflowMachine.machine_number,
        machine_created: workflowMachine.created,
        wrong_type_machine_number: oppositeMachine.machine_number,
        wrong_type_machine_part_type_code: oppositeMachine.part_type_code,
        cutter_body_serial_number: workflowCutterBody.serial_number,
        cutter_body_created: workflowCutterBody.created,
        part_number: workflowPart.part_number,
        part_created: workflowPart.created,
        wrong_type_part_number: oppositePart.part_number,
        wrong_type_part_type_code: oppositePart.part_type_code,
        changeover_reason_code: workflowPullReasons.changeover,
        teardown_reason_code: workflowPullReasons.teardown,
        source_tray_serial_number: sourceTray.serial_number,
        source_tray_created: sourceCreated,
        teardown_tray_serial_number: teardownTray.serial_number,
        teardown_tray_created: teardownTray.created,
        blade_tracking: {
          intake_tray_serial_number: intakeTray.serial_number,
          intake_tray_created: intakeTray.created,
          container_serial_number: coatingContainer.serial_number,
          container_created: coatingContainer.created,
          internal_location_a: internalLocations.a.serial_number,
          internal_location_b: internalLocations.b.serial_number,
          internal_locations_created: {
            a: internalLocations.a.created,
            b: internalLocations.b.created,
          },
        },
        shelves: {
          greenshed: shelves.greenshed.serial_number,
          rough: shelves.rough.serial_number,
          dull: shelves.dull.serial_number,
          finished: shelves.finished.serial_number,
        },
        shelves_created: {
          greenshed: shelves.greenshed.created,
          rough: shelves.rough.created,
          dull: shelves.dull.created,
          finished: shelves.finished.created,
        },
      }),
    );
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] Workflow test fixture provisioning failed: ${error.message}`);
  process.exit(1);
});
