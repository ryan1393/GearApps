// DANA-R61R14-SHIFT-COUNTS-V1
import { STARTUP_SCHEMA_LOCK_SQL } from '@gearapps/manufacturing/shared/util-constants';
// Counts are recorded increases, grouped by machine and Eastern production shift.
export interface ShiftQuery {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}
export interface ShiftDatabase extends ShiftQuery {
  transaction<T>(work: (manager: ShiftQuery) => Promise<T>): Promise<T>;
}
export interface GreenshedCurrentShift {
  number: number;
  label: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  tracking_started_at: string;
  is_complete: boolean;
}

export const SHIFT_SCHEMA_SQL = [
  `SELECT pg_advisory_xact_lock(hashtext('dana-greenshed-shift-counts-v1'))`,
  `CREATE TABLE IF NOT EXISTS public.dana_greenshed_shift_tracking (
    id smallint PRIMARY KEY CHECK (id = 1),
    schema_version integer NOT NULL,
    time_zone text NOT NULL,
    schedule text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE TABLE IF NOT EXISTS public.dana_greenshed_shift_counts (
    machine_id text NOT NULL,
    shift_start timestamptz NOT NULL,
    shift_number smallint NOT NULL CHECK (shift_number BETWEEN 1 AND 3),
    piece_count bigint NOT NULL DEFAULT 0 CHECK (piece_count >= 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (machine_id, shift_start)
  )`,
  // Retain recorded shift production when an inspection correction lowers the
  // displayed cutter count. Re-entering those pieces must not count them again.
  `CREATE TABLE IF NOT EXISTS public.dana_greenshed_count_high_water (
    run_id uuid PRIMARY KEY,
    piece_count bigint NOT NULL CHECK (piece_count >= 0)
  )`,
  `CREATE OR REPLACE FUNCTION public.dana_greenshed_shift_window_v1(moment timestamptz)
   RETURNS TABLE (shift_number integer, starts_at timestamptz, ends_at timestamptz)
   LANGUAGE sql STABLE AS $shift_window$
     WITH local_time AS (
       SELECT moment AT TIME ZONE 'America/New_York' AS wall_time
     ), boundary AS (
       SELECT CASE
         WHEN EXTRACT(HOUR FROM wall_time) >= 23 THEN 3
         WHEN EXTRACT(HOUR FROM wall_time) >= 15 THEN 2
         WHEN EXTRACT(HOUR FROM wall_time) >= 7 THEN 1
         ELSE 3 END AS number,
       CASE
         WHEN EXTRACT(HOUR FROM wall_time) >= 23 THEN date_trunc('day', wall_time) + interval '23 hours'
         WHEN EXTRACT(HOUR FROM wall_time) >= 15 THEN date_trunc('day', wall_time) + interval '15 hours'
         WHEN EXTRACT(HOUR FROM wall_time) >= 7 THEN date_trunc('day', wall_time) + interval '7 hours'
         ELSE date_trunc('day', wall_time) - interval '1 day' + interval '23 hours'
       END AS local_start
       FROM local_time
     )
     SELECT number, local_start AT TIME ZONE 'America/New_York',
       (local_start + interval '8 hours') AT TIME ZONE 'America/New_York'
     FROM boundary
   $shift_window$`,
  `CREATE OR REPLACE FUNCTION public.dana_greenshed_record_shift_count_v1()
   RETURNS trigger LANGUAGE plpgsql AS $shift_count$
   DECLARE
     recorded_at timestamptz := clock_timestamp();
     window_start timestamptz;
     window_number integer;
     delta bigint;
     counted_through bigint;
   BEGIN
     INSERT INTO public.dana_greenshed_count_high_water (run_id, piece_count)
       VALUES (NEW.id, OLD.current_piece_count) ON CONFLICT (run_id) DO NOTHING;
     SELECT GREATEST(piece_count, OLD.current_piece_count::bigint) INTO counted_through
       FROM public.dana_greenshed_count_high_water WHERE run_id = NEW.id FOR UPDATE;
     UPDATE public.dana_greenshed_count_high_water
       SET piece_count = GREATEST(counted_through, NEW.current_piece_count::bigint) WHERE run_id = NEW.id;
     delta := NEW.current_piece_count::bigint - counted_through;
     IF delta <= 0 THEN RETURN NEW; END IF;
     SELECT starts_at, shift_number INTO window_start, window_number
       FROM public.dana_greenshed_shift_window_v1(recorded_at);
     INSERT INTO public.dana_greenshed_shift_counts
       (machine_id, shift_start, shift_number, piece_count, updated_at)
       VALUES (NEW.machine_id, window_start, window_number, delta, recorded_at)
     ON CONFLICT (machine_id, shift_start) DO UPDATE SET
       piece_count = public.dana_greenshed_shift_counts.piece_count + EXCLUDED.piece_count,
       updated_at = EXCLUDED.updated_at;
     RETURN NEW;
   END
   $shift_count$`,
  `DO $shift_trigger$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.cutter_machine_runs'::regclass
         AND tgname = 'dana_greenshed_shift_count_v1'
         AND NOT tgisinternal
     ) THEN
       CREATE TRIGGER dana_greenshed_shift_count_v1
       AFTER UPDATE OF current_piece_count ON public.cutter_machine_runs
       FOR EACH ROW EXECUTE FUNCTION public.dana_greenshed_record_shift_count_v1();
     END IF;
   END
   $shift_trigger$`,
  `INSERT INTO public.dana_greenshed_shift_tracking (id, schema_version, time_zone, schedule)
   VALUES (1, 1, 'America/New_York', '07:00,15:00,23:00') ON CONFLICT (id) DO NOTHING`,
];

export async function initializeShiftTracking(database: ShiftDatabase): Promise<void> {
  await database.transaction(async (manager) => {
    // Lock and create metadata before validating/reusing any existing configuration.
    await manager.query(STARTUP_SCHEMA_LOCK_SQL);
    await manager.query(SHIFT_SCHEMA_SQL[0]);
    await manager.query(SHIFT_SCHEMA_SQL[1]);
    const current = await manager.query(
      `SELECT schema_version, time_zone, schedule FROM public.dana_greenshed_shift_tracking WHERE id = 1`,
    ) as Array<{ schema_version: number; time_zone: string; schedule: string }>;
    if (current.length && (current[0].schema_version !== 1 || current[0].time_zone !== 'America/New_York' || current[0].schedule !== '07:00,15:00,23:00')) {
      throw new Error('Greenshed shift tracking configuration differs from R61R14. Existing counts were preserved.');
    }
    for (const sql of SHIFT_SCHEMA_SQL.slice(2)) await manager.query(sql);
    const trigger = await manager.query(
      `SELECT t.tgenabled, p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid = 'public.cutter_machine_runs'::regclass AND t.tgname = 'dana_greenshed_shift_count_v1'`,
    ) as Array<{ tgenabled: string; proname: string }>;
    if (trigger.length !== 1 || !['O', 'A'].includes(trigger[0].tgenabled) || trigger[0].proname !== 'dana_greenshed_record_shift_count_v1') {
      throw new Error('Greenshed shift-count trigger verification failed.');
    }
  });
}

export async function loadCurrentShiftCounts(database: ShiftQuery, machineIds: string[], now = new Date()): Promise<{
  currentShift: GreenshedCurrentShift;
  counts: Map<string, number>;
}> {
  const windows = await database.query(
    `SELECT w.shift_number, w.starts_at, w.ends_at, m.started_at AS tracking_started_at
     FROM public.dana_greenshed_shift_window_v1($1::timestamptz) w
     CROSS JOIN public.dana_greenshed_shift_tracking m WHERE m.id = 1`,
    [now.toISOString()],
  ) as Array<{ shift_number: number; starts_at: Date | string; ends_at: Date | string; tracking_started_at: Date | string }>;
  if (windows.length !== 1) throw new Error('Greenshed shift tracking is not initialized.');
  const w = windows[0];
  const start = new Date(w.starts_at);
  const end = new Date(w.ends_at);
  const tracking = new Date(w.tracking_started_at);
  const labels = ['', '1st shift: 7 AM - 3 PM ET', '2nd shift: 3 PM - 11 PM ET', '3rd shift: 11 PM - 7 AM ET'];
  const rows = machineIds.length ? await database.query(
    `SELECT machine_id, piece_count FROM public.dana_greenshed_shift_counts
     WHERE shift_start = $1::timestamptz AND machine_id = ANY($2::text[])`,
    [start.toISOString(), machineIds],
  ) as Array<{ machine_id: string; piece_count: string | number }> : [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const count = Number(row.piece_count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid stored Greenshed shift count.');
    counts.set(row.machine_id, count);
  }
  return {
    currentShift: {
      number: w.shift_number,
      label: labels[w.shift_number],
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      time_zone: 'America/New_York',
      tracking_started_at: tracking.toISOString(),
      is_complete: tracking.getTime() <= start.getTime(),
    },
    counts,
  };
}
