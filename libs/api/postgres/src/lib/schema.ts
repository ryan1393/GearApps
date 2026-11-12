import { DataSource } from 'typeorm';
import {
  applySharedDatabaseIntegrity,
  GEAR_DATABASE_SCHEMA_LOCK,
  runDatabaseMigration,
} from '@meshforge/shared/database';
import { LAPPER_HISTORY_INTEGRITY_SQL } from './history-integrity';
import { LAPPER_ARCHIVE_GUARD_SQL } from './archive-guard';
import { COLLECTOR_TOKEN_PURPOSE_SQL, COLLECTOR_TOKENS_SQL } from './collector-tokens';

export const LAPPER_ARGONAUT_FLAGS_MIGRATION = '20261112-lapper-macro-flag-argonaut-only-v1';
/** The macros sent to Argonaut, as FLAGGABLE_MACROS lists them when this migration was written. */
export const LAPPER_ARGONAUT_FLAGS_SQL = `
      UPDATE lapper.macros SET flag_changes = (number = ANY(ARRAY[
        10039,10040,10042,10043,10045,10046,10047,10049,10050,10051,10053,10054,10055,10063,
        10209,10401,10402,10403,10404,10405,10406,10407,10408,10409,10410,10412,10413,10414,
        10415,10416,10418,10419,10421,10426,10428,10430,10433,10435,10437,10481,10482,10483,
        10484,10485,10486,10487,10488,10489,10490,10492,10493,10494,10495,10496,10498,10499,
        10501,10506,10508,10510,10513,10515,10517,10020,10021,10023,10400,10480
      ]::int[]));
    `;

// Compatible with the tested legacy import. Public manufacturing tables are
// referenced, never synchronized or rebuilt by the Lapper API.
export const LAPPER_POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS lapper.machines (
 id uuid PRIMARY KEY, number text, machine_ip text NOT NULL, scanner_ip text NOT NULL DEFAULT '',
 dept_id text, description text, type text, builder text, cell text, status text NOT NULL,
 public_machine_id uuid NOT NULL REFERENCES public.machines(id)
);
CREATE TABLE IF NOT EXISTS lapper.gearsets (
 id uuid PRIMARY KEY, number text NOT NULL, rev text, ratio numeric(20,8), status text NOT NULL,
 summary_id uuid, pinion_id uuid, ring_id uuid, user_id uuid,
 public_gearset_id uuid REFERENCES public.gearsets(id)
);
ALTER TABLE lapper.gearsets ALTER COLUMN ratio TYPE numeric(20,8);
CREATE TABLE IF NOT EXISTS lapper.macros (
 id uuid PRIMARY KEY, number integer NOT NULL, name text NOT NULL, status integer,
 type text NOT NULL, tab_index integer, used_form text, l60_table text NOT NULL, extra text
);
CREATE TABLE IF NOT EXISTS lapper.machine_cycles (
 id uuid PRIMARY KEY, consec integer NOT NULL, timestamp timestamp without time zone NOT NULL,
 machine_id uuid NOT NULL REFERENCES lapper.machines(id),
 gearset_id uuid NOT NULL REFERENCES lapper.gearsets(id), serial_number text,
 recorded_at timestamptz
);
ALTER TABLE lapper.machine_cycles ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
CREATE TABLE IF NOT EXISTS lapper.macro_logs (
 id uuid PRIMARY KEY, value numeric(13,5) NOT NULL,
 machine_cycle_id uuid NOT NULL REFERENCES lapper.machine_cycles(id),
 macro_id uuid NOT NULL REFERENCES lapper.macros(id)
);
CREATE TABLE IF NOT EXISTS lapper.scanners (
 id uuid PRIMARY KEY, model text, type text, description text, sn_procces text,
 sn_queue text, sn_scanner text, status text NOT NULL,
 machine_id uuid REFERENCES lapper.machines(id), ip text
);
ALTER TABLE lapper.scanners ALTER COLUMN machine_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS lapper.machine_fanuc_variables (
 id uuid PRIMARY KEY, x06_7_frt_dr_closed boolean NOT NULL,
 "y03_2_stack_inCycle" boolean NOT NULL, x01_2_start_cycle boolean NOT NULL,
 machine_id uuid NOT NULL REFERENCES lapper.machines(id)
);
CREATE TABLE IF NOT EXISTS lapper.type_of_checks (
 id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL
);
CREATE TABLE IF NOT EXISTS lapper.gearset_marriages (
 id uuid PRIMARY KEY, rev text, gearset_id uuid, pinion_id uuid, ring_id uuid
);
CREATE TABLE IF NOT EXISTS lapper.ingest_requests (
 scope text NOT NULL, request_key varchar(160) NOT NULL, fingerprint char(64) NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scope,request_key)
);
CREATE INDEX IF NOT EXISTS ix_lapper_cycles_machine_gear_time ON lapper.machine_cycles(machine_id,gearset_id,timestamp);
CREATE INDEX IF NOT EXISTS ix_lapper_logs_cycle_macro ON lapper.macro_logs(machine_cycle_id,macro_id);
CREATE INDEX IF NOT EXISTS ix_lapper_gearsets_public_id ON lapper.gearsets(public_gearset_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lapper_fanuc_machine ON lapper.machine_fanuc_variables(machine_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lapper_profile_master ON lapper.machines(public_machine_id);
`;

export async function migrateLapperPostgres(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    await manager.query(GEAR_DATABASE_SCHEMA_LOCK);
    await manager.query("SET LOCAL lock_timeout='5s'");
    await manager.query("SET LOCAL statement_timeout='120s'");
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('meshforge-lapper-api-schema',0))",
    );
    const [master] = await manager.query(
      "SELECT to_regclass('public.users') AS users,to_regclass('public.machines') AS machines,to_regclass('public.gearsets') AS gearsets,to_regclass('public.parts') AS parts",
    );
    if (!master.users || !master.machines || !master.gearsets || !master.parts) {
      throw new Error(
        'Lapper requires the existing MeshForge PostgreSQL database. Run the MeshForge database bootstrap first.',
      );
    }
    await manager.query('CREATE SCHEMA IF NOT EXISTS lapper');
    await manager.query(
      'CREATE TABLE IF NOT EXISTS lapper.api_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())',
    );
    const version = '20261109-postgres-lapper-v1';
    if (
      !(
        await manager.query('SELECT version FROM lapper.api_migrations WHERE version=$1', [version])
      ).length
    ) {
      await manager.query(LAPPER_POSTGRES_DDL);
      await manager.query('INSERT INTO lapper.api_migrations(version) VALUES ($1)', [version]);
    }
    await runDatabaseMigration(manager, '20261111-lapper-cycle-tests-v1', `
      CREATE TABLE IF NOT EXISTS lapper.cycle_tests (
        id uuid PRIMARY KEY, machine_id uuid NOT NULL, gearset_id uuid NOT NULL,
        serial_number varchar(160) NOT NULL, values jsonb NOT NULL, result jsonb NOT NULL,
        created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        kind text NOT NULL DEFAULT 'SIMULATION' CHECK (kind = 'SIMULATION')
      );
      CREATE INDEX IF NOT EXISTS ix_cycle_tests_created ON lapper.cycle_tests(created_at DESC);
    `);
    // Optional acceptance limits and a unit for each macro, edited in Admin > Macros.
    await runDatabaseMigration(manager, '20261111-lapper-macro-limits-v1', `
      ALTER TABLE lapper.macros ADD COLUMN IF NOT EXISTS min_value numeric(13,5);
      ALTER TABLE lapper.macros ADD COLUMN IF NOT EXISTS max_value numeric(13,5);
      ALTER TABLE lapper.macros ADD COLUMN IF NOT EXISTS unit text;
      ALTER TABLE lapper.macros DROP CONSTRAINT IF EXISTS ck_lapper_macro_limits;
      ALTER TABLE lapper.macros ADD CONSTRAINT ck_lapper_macro_limits
        CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value);
    `);
    // Per-machine Argonaut endpoint for Lapper Read, edited in Admin > Lapping machines.
    await runDatabaseMigration(manager, '20261111-lapper-machine-argonaut-v1', `
      ALTER TABLE lapper.machines ADD COLUMN IF NOT EXISTS argonaut_url text;
      ALTER TABLE lapper.machines ADD COLUMN IF NOT EXISTS argonaut_location_id text;
    `);
    await applySharedDatabaseIntegrity(manager);
    await runDatabaseMigration(
      manager,
      '20261109-lapper-history-integrity-v2',
      LAPPER_HISTORY_INTEGRITY_SQL,
    );
    await runDatabaseMigration(
      manager,
      '20261109-lapper-archive-guard-v1',
      LAPPER_ARCHIVE_GUARD_SQL,
    );
    await runDatabaseMigration(
      manager,
      '20261110-lapper-collector-tokens-v1',
      COLLECTOR_TOKENS_SQL,
    );
    await runDatabaseMigration(
      manager,
      '20261111-lapper-collector-token-purpose-v1',
      COLLECTOR_TOKEN_PURPOSE_SQL,
    );
    await runDatabaseMigration(manager, '20261111-lapper-master-data-dedup-v1', LAPPER_MASTER_DATA_DEDUP_SQL);
    // Seconds each cycle was in cycle (Y3.2), as Lapper Read measured it; null when unknown,
    // which includes every cycle recorded before collectors sent it.
    await runDatabaseMigration(manager, '20261111-lapper-cycle-time-v1', `
      ALTER TABLE lapper.machine_cycles ADD COLUMN IF NOT EXISTS cycle_time_s numeric(10,3);
      ALTER TABLE lapper.machine_cycles DROP CONSTRAINT IF EXISTS ck_lapper_cycle_time;
      ALTER TABLE lapper.machine_cycles ADD CONSTRAINT ck_lapper_cycle_time
        CHECK (cycle_time_s IS NULL OR (cycle_time_s >= 0 AND cycle_time_s <= 86400));
    `);
    // The live cycle timer: when the machine's current cycle started (database clock, derived from
    // the seconds Lapper Read reports, so no two clocks have to agree) and when the collector last
    // reported, so a stopped collector shows as stale instead of a timer that never ends.
    await runDatabaseMigration(manager, '20261111-lapper-live-cycle-v1', `
      ALTER TABLE lapper.machine_fanuc_variables ADD COLUMN IF NOT EXISTS in_cycle_since timestamptz;
      ALTER TABLE lapper.machine_fanuc_variables ADD COLUMN IF NOT EXISTS reported_at timestamptz;
    `);
    // Whether a change in the macro's value is flagged on the Lapper Dashboard (Admin > Macros).
    // Every macro starts flagged; the consec counter is never flagged whatever this says.
    await runDatabaseMigration(manager, '20261112-lapper-macro-flag-changes-v1', `
      ALTER TABLE lapper.macros ADD COLUMN IF NOT EXISTS flag_changes boolean NOT NULL DEFAULT true;
    `);
    // Setting changes are flagged only for the 68 macros sent to Argonaut (FLAGGABLE_MACROS): tick
    // those on and every other macro, the consec counter #10032 among them, off. Runs once; the
    // list is written out so this migration never changes (a test keeps it equal to the code).
    await runDatabaseMigration(manager, LAPPER_ARGONAUT_FLAGS_MIGRATION, LAPPER_ARGONAUT_FLAGS_SQL);
    // Collector Idempotency-Keys are kept for INGEST_REQUEST_RETENTION_DAYS; the daily prune
    // finds expired ones by age.
    // Where each scanner's capture is on the FTP drop (Admin > Scanners). Null keeps the default,
    // <SCANNER_FTP_ROOT>/<scanner IP>/<SCANNER_FTP_IMAGE_FILE>. No '..' segments; JPEG or BMP files.
    await runDatabaseMigration(manager, '20261112-lapper-scanner-image-location-v1', `
      ALTER TABLE lapper.scanners ADD COLUMN IF NOT EXISTS image_folder text;
      ALTER TABLE lapper.scanners ADD COLUMN IF NOT EXISTS image_file text;
      ALTER TABLE lapper.scanners DROP CONSTRAINT IF EXISTS ck_lapper_scanner_image_location;
      ALTER TABLE lapper.scanners ADD CONSTRAINT ck_lapper_scanner_image_location CHECK (
        (image_folder IS NULL OR (length(image_folder) <= 255 AND image_folder !~ '(^|/)\\.\\.(/|$)' AND image_folder !~ '[\\\\[:cntrl:]]'))
        AND (image_file IS NULL OR (length(image_file) <= 128 AND image_file ~* '^[^/\\\\[:cntrl:]]+\\.(jpe?g|bmp)$'))
      );
    `);
    await runDatabaseMigration(manager, '20261112-lapper-ingest-requests-created-v1', `
      CREATE INDEX IF NOT EXISTS ix_lapper_ingest_requests_created ON lapper.ingest_requests(created_at);
    `);
  });
}

/**
 * public.machines owns a machine's number, department, cell and description; lapper.machines
 * kept stale copies of them. A description only Lapper had is moved to the master first, so
 * nothing shown today is lost. The legacy type-of-check and gearset-marriage tables had no
 * screen or collector and are dropped with their endpoints. Runs after the legacy import
 * cut-off (lapper-history-integrity-v2), so the import can no longer write these columns.
 */
export const LAPPER_MASTER_DATA_DEDUP_SQL = `
UPDATE public.machines p SET description=btrim(l.description), "updatedAt"=now()
  FROM lapper.machines l
 WHERE l.public_machine_id=p.id AND p.description IS NULL AND nullif(btrim(l.description),'') IS NOT NULL;
ALTER TABLE lapper.machines DROP COLUMN IF EXISTS number, DROP COLUMN IF EXISTS dept_id,
  DROP COLUMN IF EXISTS cell, DROP COLUMN IF EXISTS description;
DROP TABLE IF EXISTS lapper.type_of_checks;
DROP TABLE IF EXISTS lapper.gearset_marriages;
COMMENT ON TABLE lapper.machines IS 'Lapper connection profile of a public.machines row: controller and scanner IPs, Argonaut endpoint, Lapper type/builder and Lapper status. Machine number, department, cell and description are read from public.machines.';
COMMENT ON TABLE lapper.gearsets IS 'Gearset references of recorded cycles. Rows with public_gearset_id read number, ratio and components from public.gearsets; their own columns are imported lineage. Rows without one are collector numbers not yet matched to a MeshForge assembly.';
`;
