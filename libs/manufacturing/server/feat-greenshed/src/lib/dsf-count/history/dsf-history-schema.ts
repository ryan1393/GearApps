import { STARTUP_SCHEMA_LOCK_SQL } from '@meshforge/manufacturing/shared/util-constants';

export interface HistorySchemaManager {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}
export interface HistorySchemaDatabase {
  transaction<T>(work: (manager: HistorySchemaManager) => Promise<T>): Promise<T>;
}

/** Application-side history only. Never execute this against maindblocal. */
export const DSF_HISTORY_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_history_source_v1 (
    source_key text PRIMARY KEY CHECK (source_key ~ '^[a-f0-9]{64}$'),
    system_key text NOT NULL CHECK (system_key ~ '^[a-f0-9]{64}$'),
    mapping_id uuid NOT NULL, whiteboard_id uuid NOT NULL, op_id uuid NOT NULL, line_id uuid NOT NULL,
    department_id uuid NULL, source_name text NOT NULL, line_name text NOT NULL,
    department_name text NOT NULL, asset_number text NULL,
    active boolean NOT NULL, current boolean NOT NULL DEFAULT true,
    duplicate_operation boolean NOT NULL DEFAULT false, review_reason text NULL,
    first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, current_since timestamptz NOT NULL,
    UNIQUE (system_key,mapping_id,whiteboard_id,op_id,line_id,department_id)
  )`,
  // Additive upgrade for an earlier history schema; preserve the original observation.
  `ALTER TABLE public.dana_dsf_history_source_v1 ADD COLUMN IF NOT EXISTS current_since timestamptz`,
  `UPDATE public.dana_dsf_history_source_v1 SET current_since=first_seen_at WHERE current_since IS NULL`,
  `ALTER TABLE public.dana_dsf_history_source_v1 ALTER COLUMN current_since SET NOT NULL`,
  `CREATE INDEX IF NOT EXISTS dana_dsf_history_source_v1_catalog_ix
    ON public.dana_dsf_history_source_v1(system_key,current,active,department_id)`,
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_history_hour_v1 (
    source_key text NOT NULL REFERENCES public.dana_dsf_history_source_v1(source_key),
    hour_start timestamptz NOT NULL, covered_to timestamptz NOT NULL,
    count bigint NOT NULL CHECK (count >= 0 AND count <= 9007199254740991),
    source_rows bigint NOT NULL CHECK (source_rows >= 0), last_production_at timestamptz NULL,
    source_as_of timestamptz NOT NULL, captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0), content_hash text NOT NULL,
    duplicate_operation boolean NOT NULL DEFAULT false, review_reason text NULL,
    PRIMARY KEY (source_key,hour_start),
    CHECK (hour_start = date_trunc('hour',hour_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
    CHECK (covered_to > hour_start AND covered_to <= hour_start + interval '1 hour'),
    CHECK (source_as_of >= covered_to)
  )`,
  `CREATE INDEX IF NOT EXISTS dana_dsf_history_hour_v1_time_ix
    ON public.dana_dsf_history_hour_v1(hour_start,source_key)`,
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_history_slice_v1 (
    source_key text NOT NULL, hour_start timestamptz NOT NULL,
    slice_start timestamptz NOT NULL, slice_end timestamptz NOT NULL,
    shift_id text NULL, shift_number integer NULL, shift_date date NULL,
    shift_start timestamptz NULL, shift_end timestamptz NULL,
    count bigint NOT NULL CHECK (count >= 0 AND count <= 9007199254740991),
    PRIMARY KEY (source_key,hour_start,slice_start),
    FOREIGN KEY (source_key,hour_start) REFERENCES public.dana_dsf_history_hour_v1(source_key,hour_start),
    CHECK (slice_start >= hour_start AND slice_start < slice_end AND slice_end <= hour_start + interval '1 hour'),
    CHECK ((shift_id IS NULL AND shift_number IS NULL AND shift_date IS NULL AND shift_start IS NULL AND shift_end IS NULL)
      OR (shift_id IS NOT NULL AND shift_number > 0 AND shift_date IS NOT NULL
        AND shift_start IS NOT NULL AND shift_end IS NOT NULL AND shift_end > shift_start
        AND slice_start >= shift_start AND slice_end <= shift_end))
  )`,
  `CREATE INDEX IF NOT EXISTS dana_dsf_history_slice_v1_shift_ix
    ON public.dana_dsf_history_slice_v1(shift_date,source_key,shift_id)`,
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_history_state_v1 (
    system_key text PRIMARY KEY CHECK (system_key ~ '^[a-f0-9]{64}$'),
    backfill_start timestamptz NOT NULL, next_backfill_hour timestamptz NOT NULL,
    source_as_of timestamptz NULL, last_success_at timestamptz NULL,
    last_failure_at timestamptz NULL, last_failure_code text NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_history_issue_v1 (
    system_key text NOT NULL, source_key text NOT NULL DEFAULT '', hour_start timestamptz NOT NULL,
    code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,80}$'), observed_at timestamptz NOT NULL,
    PRIMARY KEY (system_key,source_key,hour_start,code)
  )`,
  `CREATE TABLE IF NOT EXISTS public.dana_dsf_history_revision_v1 (
    id bigserial PRIMARY KEY, source_key text NOT NULL, hour_start timestamptz NOT NULL,
    previous_count bigint NOT NULL, new_count bigint NOT NULL,
    previous_hash text NOT NULL, new_hash text NOT NULL,
    previous_source_as_of timestamptz NOT NULL, new_source_as_of timestamptz NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (source_key,hour_start) REFERENCES public.dana_dsf_history_hour_v1(source_key,hour_start)
  )`,
  `CREATE INDEX IF NOT EXISTS dana_dsf_history_revision_v1_hour_ix
    ON public.dana_dsf_history_revision_v1(source_key,hour_start,changed_at)`,
];

export const DSF_HISTORY_COLUMNS: Readonly<Record<string, string>> = {
  dana_dsf_history_source_v1: 'source_key,system_key,mapping_id,whiteboard_id,op_id,line_id,department_id,source_name,line_name,department_name,asset_number,active,current,duplicate_operation,review_reason,first_seen_at,last_seen_at,current_since',
  dana_dsf_history_hour_v1: 'source_key,hour_start,covered_to,count,source_rows,last_production_at,source_as_of,captured_at,revision,content_hash,duplicate_operation,review_reason',
  dana_dsf_history_slice_v1: 'source_key,hour_start,slice_start,slice_end,shift_id,shift_number,shift_date,shift_start,shift_end,count',
  dana_dsf_history_state_v1: 'system_key,backfill_start,next_backfill_hour,source_as_of,last_success_at,last_failure_at,last_failure_code,updated_at',
  dana_dsf_history_issue_v1: 'system_key,source_key,hour_start,code,observed_at',
  dana_dsf_history_revision_v1: 'id,source_key,hour_start,previous_count,new_count,previous_hash,new_hash,previous_source_as_of,new_source_as_of,changed_at',
};

export async function ensureDsfHistorySchema(database: HistorySchemaDatabase): Promise<void> {
  await database.transaction(async manager => {
    await manager.query(STARTUP_SCHEMA_LOCK_SQL);
    const guard = await manager.query(`SELECT to_regclass('public.machines') IS NOT NULL
      AND to_regclass('public.tbl_whiteboard_cycles_master') IS NULL AS is_meshforge`) as Array<{is_meshforge: boolean}>;
    if (guard[0]?.is_meshforge !== true) throw new Error('History storage requires the MeshForge application database.');
    for (const sql of DSF_HISTORY_SCHEMA_SQL) await manager.query(sql);
    const columns = await manager.query(`SELECT table_name,string_agg(column_name,',' ORDER BY ordinal_position) AS columns
      FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])
      GROUP BY table_name`, [Object.keys(DSF_HISTORY_COLUMNS)]) as Array<{table_name: string; columns: string}>;
    for (const [table, expected] of Object.entries(DSF_HISTORY_COLUMNS)) {
      if (columns.find(row => row.table_name === table)?.columns !== expected) {
        throw new Error('History storage schema requires review; existing records were left unchanged.');
      }
    }
  });
}
