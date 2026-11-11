import { DataSource } from 'typeorm';
import {
  applySharedDatabaseIntegrity,
  GEAR_DATABASE_SCHEMA_LOCK,
  runDatabaseMigration,
} from '@meshforge/shared/database';
import { LAPPER_HISTORY_INTEGRITY_SQL } from './history-integrity';
import { LAPPER_ARCHIVE_GUARD_SQL } from './archive-guard';
import { COLLECTOR_TOKEN_PURPOSE_SQL, COLLECTOR_TOKENS_SQL } from './collector-tokens';

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
  });
}
