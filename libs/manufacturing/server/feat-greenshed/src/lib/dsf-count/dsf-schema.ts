/* MeshForge side tables for DSF cutter counts. Never run against the DSF source.
 *
 * Additive and idempotent: the same definitions as the original DSF migrations
 * (cutter ledger V1, Admin machine mapping V2), so a database that already has them is left
 * exactly as it is and its mappings, seeds and per-run/per-shift ledger are preserved.
 * Created only when the DSF reader is switched on.
 */
import { STARTUP_SCHEMA_LOCK_SQL } from '@meshforge/manufacturing/shared/util-constants';

interface SchemaQuery {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}
interface SchemaDatabase {
  transaction<T>(work: (manager: SchemaQuery) => Promise<T>): Promise<T>;
}

export const DSF_CUTTER_SCHEMA_SQL = [
  // One row per machine: where DSF attribution began for it.
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_cutter_machine_state_v1 (
     machine_id uuid PRIMARY KEY REFERENCES public.machines(id),
     seeded_run_id uuid NOT NULL REFERENCES public.cutter_machine_runs(id),
     seeded_shift_start timestamptz NOT NULL,
     seeded_at timestamptz NOT NULL,
     seeded_source_count bigint NOT NULL CHECK (seeded_source_count >= 0),
     created_at timestamptz NOT NULL DEFAULT clock_timestamp()
   )`,
  // Ledger key: machine + cutter run + shift start. What DSF has already credited to that run in that shift.
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_cutter_run_shifts_v1 (
     machine_id uuid NOT NULL REFERENCES public.machines(id),
     run_id uuid NOT NULL REFERENCES public.cutter_machine_runs(id),
     shift_start timestamptz NOT NULL,
     shift_number smallint NOT NULL CHECK (shift_number BETWEEN 1 AND 3),
     source_count bigint NOT NULL CHECK (source_count >= 0),
     run_count_after bigint NOT NULL CHECK (run_count_after >= 0),
     source_as_of timestamptz NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     PRIMARY KEY (machine_id, run_id, shift_start)
   )`,
  // Admin choice of DSF source per machine. An enabled row replaces the reference mapping; a disabled row means unmapped.
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_machine_mapping_v1 (
     machine_id uuid PRIMARY KEY REFERENCES public.machines(id),
     mapping_id uuid NULL,
     whiteboard_id uuid NULL,
     op_id uuid NULL,
     line_id uuid NULL,
     department_id uuid NULL,
     source_department text NULL,
     line_name text NULL,
     whiteboard_name text NULL,
     enabled boolean NOT NULL DEFAULT true,
     revision bigint NOT NULL DEFAULT 1,
     approved_by uuid NULL,
     approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     CONSTRAINT dana_dsf_machine_mapping_v1_revision_ck CHECK (revision > 0),
     CONSTRAINT dana_dsf_machine_mapping_v1_department_ck CHECK (source_department IS NULL OR source_department ~ '^[0-9]+$'),
     CONSTRAINT dana_dsf_machine_mapping_v1_state_ck CHECK (
       (enabled AND mapping_id IS NOT NULL AND whiteboard_id IS NOT NULL AND op_id IS NOT NULL AND line_id IS NOT NULL
         AND department_id IS NOT NULL AND source_department IS NOT NULL AND line_name IS NOT NULL AND btrim(line_name) <> ''
         AND whiteboard_name IS NOT NULL AND btrim(whiteboard_name) <> '')
       OR
       (NOT enabled AND mapping_id IS NULL AND whiteboard_id IS NULL AND op_id IS NULL AND line_id IS NULL
         AND department_id IS NULL AND source_department IS NULL AND line_name IS NULL AND whiteboard_name IS NULL)
     )
   )`,
  `ALTER TABLE public.dana_dsf_machine_mapping_v1 DROP CONSTRAINT IF EXISTS dana_dsf_machine_mapping_v1_department_ck`,
  `ALTER TABLE public.dana_dsf_machine_mapping_v1 ADD CONSTRAINT dana_dsf_machine_mapping_v1_department_ck CHECK (source_department IS NULL OR source_department ~ '^[0-9]+$')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dana_dsf_machine_mapping_v1_mapping_uq
     ON public.dana_dsf_machine_mapping_v1(mapping_id) WHERE mapping_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_machine_mapping_audit_v1 (
     id bigserial PRIMARY KEY,
     machine_id uuid NOT NULL,
     action text NOT NULL,
     previous_mapping_id uuid NULL,
     new_mapping_id uuid NULL,
     changed_by uuid NULL,
     source_snapshot jsonb NULL,
     changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     CONSTRAINT dana_dsf_machine_mapping_audit_v1_action_ck CHECK (action IN ('MAP','REMAP','UNMAP')),
     CONSTRAINT dana_dsf_machine_mapping_audit_v1_change_ck CHECK (
       (action='MAP' AND new_mapping_id IS NOT NULL)
       OR (action='REMAP' AND previous_mapping_id IS NOT NULL AND new_mapping_id IS NOT NULL)
       OR (action='UNMAP' AND new_mapping_id IS NULL)
     )
   )`,
  `CREATE INDEX IF NOT EXISTS dana_dsf_machine_mapping_audit_v1_machine_time_ix
     ON public.dana_dsf_machine_mapping_audit_v1(machine_id, changed_at DESC, id DESC)`,
];

const EXPECTED_COLUMNS: Record<string, string> = {
  dana_dsf_cutter_machine_state_v1: 'machine_id,seeded_run_id,seeded_shift_start,seeded_at,seeded_source_count,created_at',
  dana_dsf_cutter_run_shifts_v1: 'machine_id,run_id,shift_start,shift_number,source_count,run_count_after,source_as_of,updated_at',
  dana_dsf_machine_mapping_v1: 'machine_id,mapping_id,whiteboard_id,op_id,line_id,department_id,source_department,line_name,whiteboard_name,enabled,revision,approved_by,approved_at,updated_at',
  dana_dsf_machine_mapping_audit_v1: 'id,machine_id,action,previous_mapping_id,new_mapping_id,changed_by,source_snapshot,changed_at',
};

/** Create the tables if they are missing, then confirm every one has the expected columns. */
export async function ensureDsfCutterSchema(database: SchemaDatabase): Promise<void> {
  await database.transaction(async (manager) => {
    await manager.query(STARTUP_SCHEMA_LOCK_SQL);
    const guard = await manager.query(
      `SELECT to_regclass('public.machines') IS NOT NULL AND to_regclass('public.cutter_machine_runs') IS NOT NULL
         AND to_regclass('public.tbl_whiteboard_cycles_master') IS NULL AS is_meshforge`,
    ) as Array<{ is_meshforge: boolean }>;
    if (guard[0]?.is_meshforge !== true) throw new Error('DSF tables can only be created in the MeshForge database.');
    for (const sql of DSF_CUTTER_SCHEMA_SQL) await manager.query(sql);
    const columns = await manager.query(
      `SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) AS columns
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        GROUP BY table_name`,
      [Object.keys(EXPECTED_COLUMNS)],
    ) as Array<{ table_name: string; columns: string }>;
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      if (columns.find((row) => row.table_name === table)?.columns !== expected) {
        throw new Error(`DSF table ${table} does not have the expected columns. Existing data was left unchanged.`);
      }
    }
  });
}
