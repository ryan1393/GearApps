import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { shouldImportBaseData } from './bootstrap-policy.mjs';

const { Client } = pg;
const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFile), '..', '..', '..');
const args = process.argv.slice(2);
const bootstrapOnly = args.includes('--bootstrap-only');
const dir = path.resolve(projectRoot, args.find(arg => arg !== '--bootstrap-only') || './tools/manufacturing/base-data/data');

const loadDotEnv = (filePath) => {
  const values = {};
  if (!fsSync.existsSync(filePath)) return values;
  for (const rawLine of fsSync.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('\"') && value.endsWith('\"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const envFile = path.resolve(projectRoot, '.env');
const fileEnv = loadDotEnv(envFile);
const env = { ...fileEnv, ...process.env };
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
if (missingDatabaseSettings.length) {
  throw new Error(
    `Database configuration missing: ${missingDatabaseSettings.join(', ')} in ${envFile}`,
  );
}

const client = new Client({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT),
  user: env.DATABASE_USERNAME,
  password: String(env.DATABASE_PASSWORD),
  database: env.DATABASE_NAME,
});

const readJson = async (name) => {
  const raw = await fs.readFile(path.join(dir, name), 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
};

const readJsonOptional = async (name) => {
  try {
    return await readJson(name);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
};

const clean = (v) => (v == null ? null : String(v).trim());
const activeFromStatus = (v) => {
  if (v == null) return true;
  const s = String(v).trim().toUpperCase();
  return !['0', 'FALSE', 'INACTIVE', 'DISABLED', 'N'].includes(s);
};

const id = () => crypto.randomUUID();

async function importBaseData() {
  const [
    departments,
    employees,
    machines,
    models,
    summaries,
    gears,
    pinions,
    pullReasons,
    summaryAdditions,
    bladeRequirements,
    cutterBodyDefinitions,
    cutterBodies,
  ] = await Promise.all([
    readJson('departments.json'),
    readJson('employees.json'),
    readJson('machines.json'),
    readJson('models.json'),
    readJson('summaries.json'),
    readJson('gears.json'),
    readJson('pinions.json'),
    readJson('cutter_pull_reasons.json'),
    readJsonOptional('summary_additions.json'),
    readJsonOptional('cutter_blade_requirements.json'),
    readJsonOptional('cutter_body_definitions.json'),
    readJsonOptional('cutter_bodies.json'),
  ]);

  const departmentIds = new Map();
  for (const row of departments) {
    const newId = id();
    await client.query(
      `INSERT INTO departments
       (id, code, description, active, enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,true,true,NOW(),NOW())
       ON CONFLICT (code) DO UPDATE
       SET description=EXCLUDED.description, active=true, enabled=true, "updatedAt"=NOW()
       RETURNING id`,
      [newId, clean(row.Department_ID), clean(row.Department_Desc) ?? ''],
    ).then(({ rows }) => departmentIds.set(String(row.Dept_ID), rows[0].id));
  }
  // The legacy cutter database has no Lapping department, and Lapper machines belong to it.
  // A department that already exists is left exactly as it is.
  await client.query(
    `INSERT INTO departments
     (id, code, description, active, enabled, "createdAt", "updatedAt")
     VALUES ($1,'181','LAPPING',true,true,NOW(),NOW())
     ON CONFLICT (code) DO NOTHING`,
    [id()],
  );

  const modelIds = new Map();
  for (const row of models) {
    const modelNumber = row.Model == null ? null : Number(row.Model);
    const modelType = clean(row.Type);

    const existing = await client.query(
      `SELECT id
       FROM models
       WHERE model_number IS NOT DISTINCT FROM $1
         AND model_type IS NOT DISTINCT FROM $2
       LIMIT 1`,
      [modelNumber, modelType],
    );

    let modelId;
    if (existing.rows[0]) {
      modelId = existing.rows[0].id;
      await client.query(
        `UPDATE models
         SET active=$2, enabled=true, "updatedAt"=NOW()
         WHERE id=$1`,
        [modelId, activeFromStatus(row.Status)],
      );
    } else {
      modelId = id();
      await client.query(
        `INSERT INTO models
         (id, model_number, model_type, active, enabled, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,true,NOW(),NOW())`,
        [modelId, modelNumber, modelType, activeFromStatus(row.Status)],
      );
    }
    modelIds.set(String(row.Model_ID), modelId);
  }

  const userIds = new Map();
  for (const row of employees) {
    const departmentId = departmentIds.get(String(row.Dept_ID));
    if (!departmentId) {
      throw new Error(`Employee ${row.Emp_ID}: missing Department ${row.Dept_ID}`);
    }

    const newId = id();
    const result = await client.query(
      `INSERT INTO users
       (id, email, password, "employeeNumber", "departmentId",
        "firstName", "lastName", avatar, role, "refreshToken",
        "socialProvider", "socialId", "isEmailVerified", "verificationHash",
        "emailVerifiedOn", active, "createdAt", "updatedAt")
       VALUES ($1,NULL,NULL,$2,$3,$4,$5,NULL,'user',NULL,
               'email',NULL,false,NULL,NULL,$6,NOW(),NOW())
       ON CONFLICT ("employeeNumber") DO UPDATE
       SET "departmentId"=EXCLUDED."departmentId",
           "firstName"=EXCLUDED."firstName",
           "lastName"=EXCLUDED."lastName",
           active=EXCLUDED.active,
           "updatedAt"=NOW()
       RETURNING id`,
      [
        newId,
        clean(row.Emp_ID),
        departmentId,
        clean(row.Name_First) ?? '',
        clean(row.Name_Last) ?? '',
        activeFromStatus(row.Status),
      ],
    );
    userIds.set(String(row.Emp_ID), result.rows[0].id);
  }

  for (const row of machines) {
    const departmentId =
      row.Dept_ID == null ? null : departmentIds.get(String(row.Dept_ID));
    if (!departmentId) {
      throw new Error(
        `Machine ${row.Asset_ID}: missing Department ${row.Dept_ID}`,
      );
    }

    const machineNumber = clean(row.Asset_ID)?.toUpperCase();
    if (!machineNumber) continue;

    await client.query(
      `INSERT INTO machines
       (id, machine_number, department_id, cell, active, description,
        enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,NULL,true,NOW(),NOW())
       ON CONFLICT (machine_number) DO UPDATE
       SET department_id=EXCLUDED.department_id,
           cell=EXCLUDED.cell,
           active=EXCLUDED.active,
           enabled=true,
           "updatedAt"=NOW()`,
      [
        id(),
        machineNumber,
        departmentId,
        row.Cell == null ? null : Number(row.Cell),
        activeFromStatus(row.Status),
      ],
    );
  }

  const summaryIds = new Map();
  for (const row of summaries) {
    const modelId =
      row.Model_ID == null ? null : modelIds.get(String(row.Model_ID)) ?? null;

    const newId = id();
    const result = await client.query(
      `INSERT INTO part_summaries
       (id, number, revision, model_id, hos, active, enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
       ON CONFLICT (number, revision) DO UPDATE
       SET model_id=EXCLUDED.model_id,
           hos=EXCLUDED.hos,
           active=EXCLUDED.active,
           enabled=true,
           "updatedAt"=NOW()
       RETURNING id`,
      [
        newId,
        clean(row.Summary),
        clean(row.Summary_Rev) ?? '',
        modelId,
        clean(row.HoS),
        activeFromStatus(row.Status),
      ],
    );
    summaryIds.set(String(row.Summary_ID), result.rows[0].id);
  }

  for (const row of summaryAdditions) {
    const number = clean(row.Summary);
    const revision = clean(row.Summary_Rev) ?? '';
    if (!number) {
      throw new Error('summary_additions.json contains a blank Summary');
    }

    // The supplemental list represents summaries that were missing when the
    // workbook was cleaned. Because the SQL Server export is fresh, one of
    // those summaries may have been added to SQL Server since then. If Excel
    // has no revision, reuse the single fresh SQL revision instead of creating
    // a duplicate blank-revision row.
    if (!revision) {
      const existingByNumber = await client.query(
        `SELECT id, revision
           FROM part_summaries
          WHERE number=$1 AND enabled=true
          ORDER BY revision ASC`,
        [number],
      );

      // One or more revisions already exist: the summary is present, nothing to add.
      // (existingByNumber.rows.length === 1 was the original rule; several revisions
      // are equally fine because this step only guarantees existence.)
      if (existingByNumber.rows.length >= 1) {
        continue;
      }
    }

    await client.query(
      `INSERT INTO part_summaries
       (id, number, revision, model_id, hos, active, enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,NULL,NULL,true,true,NOW(),NOW())
       ON CONFLICT (number, revision) DO UPDATE
       SET active=true, enabled=true, "updatedAt"=NOW()`,
      [id(), number, revision],
    );
  }

  // Excel blade requirements are keyed primarily by Summary number. The
  // workbook has blank Summary_Rev values, while the database may hold several
  // revisions of the same summary (for example 30135 blank and B).
  //
  // Rules:
  //   * explicit Excel revision -> exactly that Summary + Revision
  //   * Summary_Rev "(blank)"    -> exactly the blank revision
  //   * blank Excel revision     -> EVERY enabled revision of that summary (the plant
  //                                 confirmed blade requirements are the same across
  //                                 revisions); if none exists, a blank revision is created
  const BLANK_REVISION = '(blank)';
  const requirementRevision = (row) => {
    const raw = clean(row.Summary_Rev) ?? '';
    return raw.toLowerCase() === BLANK_REVISION
      ? { revision: '', explicit: true }
      : { revision: raw, explicit: raw !== '' };
  };
  const bladeRequirementSummaryKeys = new Map();
  for (const row of bladeRequirements) {
    const number = clean(row.Summary);
    const { revision, explicit } = requirementRevision(row);
    if (!number) {
      throw new Error('cutter_blade_requirements.json contains a blank Summary');
    }
    bladeRequirementSummaryKeys.set(`${number}\u0000${revision}\u0000${explicit}`, { number, revision, explicit });
  }

  const resolveBladeRequirementSummaryIds = async (number, revision, explicit = Boolean(revision)) => {
    if (explicit) {
      const exact = await client.query(
        `SELECT id
           FROM part_summaries
          WHERE number=$1 AND revision=$2 AND enabled=true
          LIMIT 1`,
        [number, revision],
      );
      return exact.rows.map((r) => r.id);
    }

    const matches = await client.query(
      `SELECT id
         FROM part_summaries
        WHERE number=$1 AND enabled=true
        ORDER BY active DESC, revision ASC`,
      [number],
    );
    return matches.rows.map((r) => r.id);
  };

  for (const { number, revision, explicit } of bladeRequirementSummaryKeys.values()) {
    const existingIds = await resolveBladeRequirementSummaryIds(number, revision, explicit);
    if (existingIds.length) continue;

    await client.query(
      `INSERT INTO part_summaries
       (id, number, revision, model_id, hos, active, enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,NULL,NULL,true,true,NOW(),NOW())
       ON CONFLICT (number, revision) DO UPDATE
       SET enabled=true,
           "updatedAt"=NOW()`,
      [id(), number, revision],
    );
  }


  const partTypes = await client.query(
    `SELECT id, code FROM part_types WHERE code IN ('RING','PINION') AND enabled=true`,
  );
  const partTypeByCode = new Map(partTypes.rows.map((r) => [r.code, r.id]));
  if (!partTypeByCode.get('RING') || !partTypeByCode.get('PINION')) {
    throw new Error('RING/PINION part_types must be bootstrapped before base-data import.');
  }

  const importParts = async (rows, kind) => {
    const isRing = kind === 'RING';
    for (const row of rows) {
      const partNumber = clean(isRing ? row.Gear : row.Pinion);
      if (!partNumber) continue;

      const summaryId = summaryIds.get(String(row.Summary_ID));
      if (!summaryId) {
        throw new Error(`${kind} ${partNumber}: missing Summary ${row.Summary_ID}`);
      }

      const teeth = row.Teeth == null ? null : Number(row.Teeth);
      if (teeth != null && (!Number.isInteger(teeth) || teeth <= 0)) {
        throw new Error(`${kind} ${partNumber}: invalid Teeth ${row.Teeth}`);
      }

      const partResult = await client.query(
        `INSERT INTO parts
         (id, part_number, summary_id, part_type_id, teeth,
          active, enabled, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
         ON CONFLICT (part_number) DO UPDATE
         SET summary_id=EXCLUDED.summary_id,
             part_type_id=EXCLUDED.part_type_id,
             teeth=EXCLUDED.teeth,
             active=EXCLUDED.active,
             enabled=true,
             "updatedAt"=NOW()
         RETURNING id`,
        [
          id(),
          partNumber,
          summaryId,
          partTypeByCode.get(kind),
          teeth,
          activeFromStatus(row.Status),
        ],
      );

      const requiredCount =
        row.Roll_Master_Needed == null ? 0 : Number(row.Roll_Master_Needed);

      if (!Number.isInteger(requiredCount) || requiredCount < 0) {
        throw new Error(
          `${kind} ${partNumber}: invalid Roll_Master_Needed ${row.Roll_Master_Needed}`,
        );
      }

      await client.query(
        `INSERT INTO roll_masters
         (id, part_id, required_count, current_quantity, minimum_quantity, active, enabled, notes, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,0,$3,true,true,NULL,NOW(),NOW())
         ON CONFLICT (part_id) DO UPDATE
         SET required_count=EXCLUDED.required_count,
             minimum_quantity=EXCLUDED.minimum_quantity,
             active=true,
             enabled=true,
             "updatedAt"=NOW()`,
        [id(), partResult.rows[0].id, requiredCount],
      );
    }
  };

  await importParts(gears, 'RING');
  await importParts(pinions, 'PINION');


  for (const row of bladeRequirements) {
    const summaryNumber = clean(row.Summary);
    const { revision, explicit } = requirementRevision(row);
    const partTypeCode = clean(row.Part_Type_Code)?.toUpperCase();
    const requiredBladeCount = Number(row.Blades_Required);

    if (!summaryNumber) throw new Error('Blade requirement has a blank Summary');
    if (!['RING', 'PINION'].includes(partTypeCode)) {
      throw new Error(
        `Summary ${summaryNumber}: invalid Part_Type_Code ${row.Part_Type_Code}`,
      );
    }
    if (!Number.isInteger(requiredBladeCount) || requiredBladeCount <= 0) {
      throw new Error(
        `Summary ${summaryNumber} ${partTypeCode}: invalid Blades_Required ${row.Blades_Required}`,
      );
    }

    const summaryIds = await resolveBladeRequirementSummaryIds(
      summaryNumber,
      revision,
      explicit,
    );
    if (!summaryIds.length) {
      throw new Error(
        `Blade requirement ${summaryNumber} ${partTypeCode}: summary resolution failed after bootstrap`,
      );
    }

    const partTypeId = partTypeByCode.get(partTypeCode);
    for (const summaryId of summaryIds) {
      await client.query(
        `INSERT INTO cutter_blade_requirements
         (id, summary_id, part_type_id, required_blade_count, enabled, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,true,NOW(),NOW())
         ON CONFLICT (summary_id, part_type_id) DO UPDATE
         SET required_blade_count=EXCLUDED.required_blade_count,
             enabled=true,
             "updatedAt"=NOW()`,
        [id(), summaryId, partTypeId, requiredBladeCount],
      );
    }
  }

  // Cutter body definition/reference data decoded from the Dana serial convention.
  await client.query(`
    CREATE TABLE IF NOT EXISTS cutter_body_definitions (
      id uuid PRIMARY KEY,
      definition_code varchar NOT NULL UNIQUE,
      cutter_head_code varchar NOT NULL,
      supplier_code varchar NOT NULL,
      supplier_name varchar NOT NULL,
      hand_code varchar NOT NULL,
      hand_name varchar NOT NULL,
      blade_family_code varchar NOT NULL,
      blade_family_name varchar NOT NULL,
      size_code varchar NOT NULL,
      size_description varchar NULL,
      enabled boolean NOT NULL DEFAULT true,
      "createdAt" timestamp NOT NULL DEFAULT NOW(),
      "updatedAt" timestamp NOT NULL DEFAULT NOW(),
      "createdBy" varchar NULL,
      "updatedBy" varchar NULL,
      "deletedAt" timestamp NULL,
      "deletedBy" varchar NULL
    )
  `);

  const cutterDefinitionIds = new Map();
  for (const row of cutterBodyDefinitions) {
    const definitionCode = clean(row.Definition_Code)?.toUpperCase();
    if (!definitionCode) {
      throw new Error('cutter_body_definitions.json contains a blank Definition_Code');
    }

    const result = await client.query(
      `INSERT INTO cutter_body_definitions
       (id, definition_code, cutter_head_code, supplier_code, supplier_name,
        hand_code, hand_name, blade_family_code, blade_family_name,
        size_code, size_description, enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
       ON CONFLICT (definition_code) DO UPDATE
       SET cutter_head_code=EXCLUDED.cutter_head_code,
           supplier_code=EXCLUDED.supplier_code,
           supplier_name=EXCLUDED.supplier_name,
           hand_code=EXCLUDED.hand_code,
           hand_name=EXCLUDED.hand_name,
           blade_family_code=EXCLUDED.blade_family_code,
           blade_family_name=EXCLUDED.blade_family_name,
           size_code=EXCLUDED.size_code,
           size_description=EXCLUDED.size_description,
           enabled=EXCLUDED.enabled,
           "updatedAt"=NOW()
       RETURNING id`,
      [
        id(),
        definitionCode,
        clean(row.Cutter_Head_Code),
        clean(row.Supplier_Code),
        clean(row.Supplier_Name),
        clean(row.Hand_Code),
        clean(row.Hand_Name),
        clean(row.Blade_Family_Code),
        clean(row.Blade_Family_Name),
        clean(row.Size_Code),
        clean(row.Size_Description),
        row.Enabled !== false,
      ],
    );
    cutterDefinitionIds.set(definitionCode, result.rows[0].id);
  }

  // Cutter body identity model:
  // - mf_serial_number is the permanent manufacturer identifier and is required.
  // - dana_serial_number is nullable until the cutter body is etched.
  // Existing builds/history remain linked by cutter_body_id UUID, so adding Dana
  // later does not change prior history.
  await client.query(
    `ALTER TABLE cutter_bodies
     ADD COLUMN IF NOT EXISTS dana_serial_number varchar`,
  );
  await client.query(
    `ALTER TABLE cutter_bodies
     ADD COLUMN IF NOT EXISTS mf_serial_number varchar`,
  );
  await client.query(
    `ALTER TABLE cutter_bodies
     ADD COLUMN IF NOT EXISTS definition_id uuid`,
  );

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_attribute a
            ON a.attrelid = t.oid
           AND a.attnum = ANY(c.conkey)
         WHERE c.contype = 'f'
           AND t.relname = 'cutter_bodies'
           AND a.attname = 'definition_id'
      ) THEN
        ALTER TABLE cutter_bodies
          ADD CONSTRAINT fk_cutter_bodies_definition
          FOREIGN KEY (definition_id)
          REFERENCES cutter_body_definitions(id);
      END IF;
    END $$;
  `);


  // Migrate the two short-lived/legacy cutter-body serial columns before
  // importing the new MF + nullable-Dana model. Dropping the old columns is
  // important: the former serial_number column was NOT NULL, so leaving it in
  // place would prevent inserting an unetched cutter that has only an MF S/N.
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'cutter_bodies'
           AND column_name = 'serial_number'
      ) THEN
        EXECUTE 'UPDATE cutter_bodies
                    SET dana_serial_number = COALESCE(dana_serial_number, serial_number)';
        EXECUTE 'ALTER TABLE cutter_bodies DROP COLUMN serial_number';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'cutter_bodies'
           AND column_name = 'manufacturing_serial_number'
      ) THEN
        EXECUTE 'UPDATE cutter_bodies
                    SET mf_serial_number = COALESCE(mf_serial_number, manufacturing_serial_number)';
        EXECUTE 'ALTER TABLE cutter_bodies DROP COLUMN manufacturing_serial_number';
      END IF;
    END $$;
  `);

  for (const row of cutterBodies) {
    const danaSerial = clean(row.Dana_Serial)?.toUpperCase() || null;
    const mfSerial = clean(row.MF_Serial)?.toUpperCase();
    const definitionCode = clean(row.Definition_Code)?.toUpperCase() || null;
    const definitionId = definitionCode
      ? cutterDefinitionIds.get(definitionCode) ?? null
      : null;

    if (definitionCode && !definitionId) {
      throw new Error(`Cutter body ${mfSerial || danaSerial}: unknown Definition_Code ${definitionCode}`);
    }

    if (!mfSerial) {
      throw new Error('cutter_bodies.json contains a blank MF/manufacturer serial');
    }

    const existing = await client.query(
      `SELECT id, dana_serial_number, mf_serial_number
         FROM cutter_bodies
        WHERE UPPER(mf_serial_number) = $1
           OR ($2::varchar IS NOT NULL AND UPPER(dana_serial_number) = $2)
        ORDER BY CASE WHEN UPPER(mf_serial_number) = $1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [mfSerial, danaSerial],
    );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE cutter_bodies
            SET dana_serial_number = COALESCE($2, dana_serial_number),
                mf_serial_number = $1,
                definition_id = $3,
                enabled = true,
                "updatedAt" = NOW()
          WHERE id = $4`,
        [mfSerial, danaSerial, definitionId, existing.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO cutter_bodies
         (id, dana_serial_number, mf_serial_number, definition_id, description, enabled, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,NULL,true,NOW(),NOW())`,
        [id(), danaSerial, mfSerial, definitionId],
      );
    }
  }

  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_cutter_bodies_mf_serial
       ON cutter_bodies (UPPER(mf_serial_number))`,
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_cutter_bodies_dana_serial
       ON cutter_bodies (UPPER(dana_serial_number))
       WHERE dana_serial_number IS NOT NULL`,
  );

  for (const row of pullReasons) {
    const legacyId = Number(row.PCR_ID);
    const description = clean(row.PCR_Desc);
    if (!Number.isInteger(legacyId) || !description) continue;

    const code = `PCR_${String(legacyId).padStart(3, '0')}`;
    const isChangeover = legacyId === 2;

    await client.query(
      `INSERT INTO cutter_pull_reasons
       (id, code, name, description, requires_teardown, returns_to_shelf,
        sort_order, enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$3,$4,$5,$6,true,NOW(),NOW())
       ON CONFLICT (code) DO UPDATE
       SET name=EXCLUDED.name,
           description=EXCLUDED.description,
           requires_teardown=EXCLUDED.requires_teardown,
           returns_to_shelf=EXCLUDED.returns_to_shelf,
           sort_order=EXCLUDED.sort_order,
           enabled=true,
           "updatedAt"=NOW()`,
      [id(), code, description, !isChangeover, isChangeover, legacyId],
    );
  }

  // Remove only the unused generic bootstrap reasons. Existing referenced rows
  // are intentionally preserved so this import never breaks a foreign key.
  await client.query(
    `DELETE FROM cutter_pull_reasons r
     WHERE r.code IN ('DULL','DAMAGED','CHANGEOVER','QUALITY','OTHER')
       AND NOT EXISTS (
         SELECT 1 FROM cutter_events e WHERE e.pull_reason_id = r.id
       )`,
  );
  // Referenced generic rows stay for history but must not be offered next to the plant's
  // own reasons (the Pull page would otherwise show two changeover reasons).
  await client.query(
    `UPDATE cutter_pull_reasons SET enabled = false, "updatedAt" = NOW()
     WHERE code IN ('DULL','DAMAGED','CHANGEOVER','QUALITY','OTHER') AND enabled = true`,
  );

  await client.query('COMMIT');
  console.log('Base/master data import complete.');
  console.log({
    departments: departments.length,
    users_from_employees: employees.length,
    machines: machines.length,
    models: models.length,
    summaries: summaries.length,
    gears: gears.length,
    pinions: pinions.length,
    cutter_pull_reasons: pullReasons.length,
    summary_additions: summaryAdditions.length,
    cutter_blade_requirements: bladeRequirements.length,
    cutter_body_definitions: cutterBodyDefinitions.length,
    cutter_bodies: cutterBodies.length,
  });
}

await client.connect();
await client.query('BEGIN');
try {
  if (await shouldImportBaseData(client, bootstrapOnly)) {
    await importBaseData();
  } else {
    await client.query('COMMIT');
    console.log('[PASS] Existing master data detected; automatic base-data import skipped. Operational edits are preserved.');
  }
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
