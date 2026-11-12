/* DANA-DSF-CUTTER-V1. Opt-in attribution of already-verified DSF production to
 * MeshForge cutter machine runs. The source is read-only; writes go ONLY to the MeshForge DB.
 * Requires DSF_CUTTER_WRITE_ENABLED=true.
 *
 * Ledger key: machine + cutter run + shift start. Each poll computes how many RUN pieces the
 * current shift holds for the installed cutter, compares that with what the ledger already
 * credited for the same key, and adds only the difference to the cutter's piece count. A new
 * shift starts a new ledger row while the cutter total keeps accumulating; a new cutter is a
 * new run. A decrease, or a cutter count changed by something other than this writer, stops
 * crediting for review instead of guessing.
 *
 * Activation baseline. The first time a machine is credited, its row in
 * dana_dsf_cutter_machine_state_v1 records that moment and crediting starts there: production
 * earlier in that shift is NOT added to the cutter, whose existing count stands. (The original
 * release instead ran a one-time INITIAL_TEST_SEED that assigned the whole shift total to the
 * installed cutter. That bootstrap is not replayed; rows it left behind belong to past shifts
 * and are simply never matched again.)
 */
import { DataSource } from 'typeorm';
import { DsfCache, timestampUs } from './dsf-core';

export interface CutterAttributionInput {
  machine_id: string;
  machine_number: string;
  department: string;
  cache: DsfCache;
}
export type CutterAttributionStatus = 'APPLIED' | 'NO_CHANGE' | 'PENDING_NEW_RUN' | 'REVIEW';
export interface CutterAttributionResult { status: CutterAttributionStatus; reason: string; }

type RawRun = {
  id: string; machine_id: string; current_piece_count: number; last_check_piece_count: number;
  installed_at_utc: string; removed_at_utc: string | null;
};
type Anchor = {
  seeded_run_id: string; seeded_shift_start: string | Date;
  seeded_at: string | Date; seeded_source_count: number | string;
};
type Ledger = {
  source_count: number | string; run_count_after: number | string;
  shift_start: string | Date;
};

export function safeInteger(v: unknown, kind: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new AttributionReview(kind);
  return n;
}
export class AttributionReview extends Error {
  constructor(readonly reason: string) { super(reason); this.name='AttributionReview'; }
}
export function creditedCycles(cache: DsfCache, startInclusiveUs: bigint): number {
  const ceiling = timestampUs(cache.as_of);
  let total = 0;
  for (const row of cache.rows.values()) {
    if (row.reason_code !== '1') continue;
    const t = BigInt(row.at_us);
    if (t >= startInclusiveUs && t < ceiling) {
      total += safeInteger(row.parts,'INVALID_SOURCE_CYCLE');
      if (!Number.isSafeInteger(total)) throw new AttributionReview('SOURCE_SUM_OVERFLOW');
    }
  }
  return total;
}
/** RUN pieces the current shift holds for this cutter run: from the later of shift start and
 * installation, and, in the shift where this machine was first credited, from that activation. */
export function desiredCutterShiftCount(cache: DsfCache, runInstalledAtUtc: string,
  anchor: Anchor | null, runId: string): number {
  const start = timestampUs(cache.shift.starts_at);
  const installed = timestampUs(runInstalledAtUtc);
  const from = start > installed ? start : installed;
  if (anchor && anchor.seeded_run_id === runId &&
      timestampUs(utc(anchor.seeded_shift_start)) === start) {
    const activatedAt = timestampUs(utc(anchor.seeded_at));
    safeInteger(anchor.seeded_source_count,'INVALID_SEED');
    if (activatedAt < start || activatedAt > timestampUs(cache.as_of)) throw new AttributionReview('INVALID_SEED_WINDOW');
    return creditedCycles(cache,activatedAt>from?activatedAt:from);
  }
  return creditedCycles(cache,from);
}
function utc(value: string | Date): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new AttributionReview('INVALID_DANA_TIMESTAMP');
    return value.toISOString();
  }
  const s=String(value);
  if (!s.endsWith('Z') && !/[+-]\d\d:\d\d$/.test(s)) throw new AttributionReview('UNZONED_DANA_TIMESTAMP');
  return s;
}
function epochMs(s: string): number {
  const d=Date.parse(s);
  if (!Number.isFinite(d)) throw new AttributionReview('INVALID_TIMESTAMP');
  return d;
}

/** Called only on a fresh, successful DSF read. One short Dana DB transaction
 * per machine, with machine and run row locks. Never connects to the DSF DB. */
export async function applyDsfCutterCounts(db: DataSource,
  machines: CutterAttributionInput[]): Promise<Map<string,CutterAttributionResult>> {
  const results=new Map<string,CutterAttributionResult>();
  for(const item of machines) {
    try {
      const result=await applyMachine(db,item);
      results.set(item.machine_id,result);
    } catch(e) {
      const reason=e instanceof AttributionReview?e.reason:'DANA_WRITE_UNAVAILABLE';
      results.set(item.machine_id,{status:'REVIEW',reason});
    }
  }
  return results;
}

async function applyMachine(db: DataSource, item: CutterAttributionInput):Promise<CutterAttributionResult> {
  const {cache}=item;
  // Existing cutter-run timestamp columns are timezone-naive; this release
  // refuses attribution unless the API process uses UTC timestamps.
  if (new Date().getTimezoneOffset()!==0) throw new AttributionReview('API_TIMESTAMP_TIMEZONE_REVIEW');
  if (item.department!=='132' && item.department!=='152') throw new AttributionReview('DEPARTMENT_OUT_OF_SCOPE');
  if (cache.count!==creditedCycles(cache,timestampUs(cache.shift.starts_at))) throw new AttributionReview('SOURCE_TOTAL_MISMATCH');
  if (timestampUs(cache.as_of) <= timestampUs(cache.shift.starts_at) ||
      timestampUs(cache.as_of) >= timestampUs(cache.shift.effective_end))
    throw new AttributionReview('SOURCE_SHIFT_NOT_CURRENT');
  if (Date.now()-epochMs(cache.as_of)>90000 || epochMs(cache.as_of)-Date.now()>15000)
    throw new AttributionReview('SOURCE_READ_NOT_FRESH');

  return db.transaction(async manager => {
    await manager.query("SET LOCAL TIME ZONE 'UTC'");
    await manager.query("SET LOCAL lock_timeout='1200ms'");
    await manager.query("SET LOCAL statement_timeout='6s'");
    const machines=await manager.query(`SELECT m.id::text AS id, btrim(m.machine_number) AS number,
      d.code AS department FROM public.machines m
      JOIN public.departments d ON d.id=m.department_id
      WHERE m.id=$1::uuid AND m."deletedAt" IS NULL AND m.active AND m.enabled
        AND d."deletedAt" IS NULL AND d.active AND d.enabled AND d.code IN ('132','152')
      FOR UPDATE OF m`,[item.machine_id]) as Array<{id:string;number:string;department:string}>;
    if (machines.length!==1 || machines[0].number!==item.machine_number ||
        machines[0].department!==item.department) throw new AttributionReview('MACHINE_IDENTITY_CHANGED');

    const windows=await manager.query(`SELECT w.shift_number AS number,w.starts_at AS start
      FROM public.dana_greenshed_shift_window_v1($1::timestamptz) w`,[cache.as_of]) as Array<{number:number;start:string|Date}>;
    if (windows.length!==1 || Number(windows[0].number)!==cache.shift.number ||
        Math.abs(epochMs(utc(windows[0].start))-epochMs(cache.shift.starts_at))>1000)
      throw new AttributionReview('SHIFT_SCHEDULE_MISMATCH');
    const canonicalShiftStart=utc(windows[0].start);

    const runs=await manager.query(`SELECT r.id::text AS id,r.machine_id::text AS machine_id,
      r.current_piece_count,r.last_check_piece_count,
      to_char(r.installed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS installed_at_utc,
      CASE WHEN r.removed_at IS NOT NULL THEN
        to_char(r.removed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE NULL END AS removed_at_utc
      FROM public.cutter_machine_runs r WHERE r.machine_id=$1::uuid
        AND r.enabled AND r.removed_at IS NULL AND r."deletedAt" IS NULL
      FOR UPDATE OF r`,[item.machine_id]) as RawRun[];
    if (runs.length===0) return {status:'PENDING_NEW_RUN',reason:'NO_ACTIVE_CUTTER'};
    if (runs.length!==1) throw new AttributionReview('ACTIVE_RUN_AMBIGUOUS');
    const run=runs[0];
    const before=safeInteger(run.current_piece_count,'INVALID_RUN_COUNT');
    // A quality check leaves the DSF-credited count alone and may be taken at a count DSF has
    // not credited yet, so the last check point can be above the running count.
    safeInteger(run.last_check_piece_count,'INVALID_CHECK_COUNT');
    if (timestampUs(run.installed_at_utc)>timestampUs(cache.as_of))
      return {status:'PENDING_NEW_RUN',reason:'DSF_READ_PREDATES_SETUP'};
    if (before>2147483647) throw new AttributionReview('COUNT_EXCEEDS_INT4');

    // Read the timestamps as text: a JavaScript Date would drop the microseconds the comparison needs.
    const anchors=await manager.query(`SELECT seeded_run_id::text,
        to_char(seeded_shift_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS seeded_shift_start,
        to_char(seeded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS seeded_at,
        seeded_source_count FROM public.dana_dsf_cutter_machine_state_v1
      WHERE machine_id=$1::uuid FOR UPDATE`,[item.machine_id]) as Anchor[];
    if (anchors.length>1) throw new AttributionReview('MACHINE_SEED_AMBIGUOUS');
    let anchor=anchors[0]||null;
    let justSeeded=false;
    if (!anchor) {
      // Exactly one activation baseline per machine. It records where crediting begins and
      // adds nothing: quality-check watermarks, setup events and the cutter's count stand.
      anchor={seeded_run_id:run.id,seeded_shift_start:canonicalShiftStart,
        seeded_at:cache.as_of,seeded_source_count:cache.count};
      await manager.query(`INSERT INTO public.dana_dsf_cutter_machine_state_v1
          (machine_id,seeded_run_id,seeded_shift_start,seeded_at,seeded_source_count)
          VALUES ($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,$5::bigint)`,
        [item.machine_id,run.id,canonicalShiftStart,cache.as_of,cache.count]);
      justSeeded=true;
    }

    const desired=desiredCutterShiftCount(cache,run.installed_at_utc,anchor,run.id);
    if (!Number.isSafeInteger(desired) || desired>2147483647) throw new AttributionReview('DESIRED_OVERFLOW');
    const ledgers=await manager.query(`SELECT source_count,run_count_after,shift_start
        FROM public.dana_dsf_cutter_run_shifts_v1
      WHERE machine_id=$1::uuid AND run_id=$2::uuid AND shift_start=$3::timestamptz FOR UPDATE`,
      [item.machine_id,run.id,canonicalShiftStart]) as Ledger[];
    if (ledgers.length>1) throw new AttributionReview('SHIFT_LEDGER_AMBIGUOUS');
    const prior=ledgers[0] || null;
    if (justSeeded && prior) throw new AttributionReview('INITIAL_SEED_LEDGER_EXISTS');
    const already=prior?safeInteger(prior.source_count,'INVALID_LEDGER'):0;
    if (prior && safeInteger(prior.run_count_after,'INVALID_LEDGER_RUN')!==before)
      throw new AttributionReview('RUN_CHANGED_OUTSIDE_DSF');
    if (desired<already) throw new AttributionReview('DSF_COUNT_DECREASE_REVIEW');
    const delta=desired-already;
    const after=before+delta;
    if (after>2147483647) throw new AttributionReview('RUN_COUNT_OVERFLOW');
    if (delta>0) {
      // TypeORM PostgreSQL raw UPDATE returns [rows, affectedRows] in 0.3.30.
      // Wrap the unchanged guarded UPDATE in a SELECT-returning CTE so query()
      // returns only rows; preserve strict exactly-one-row identity checking.
      const change=await manager.query(`WITH updated AS (
         UPDATE public.cutter_machine_runs
         SET current_piece_count=$2::integer,"updatedAt"=clock_timestamp()
         WHERE id=$1::uuid AND enabled AND removed_at IS NULL
         RETURNING id
       ) SELECT id::text AS id FROM updated`,[run.id,after]) as Array<{id:string}>;
      if (change.length!==1 || change[0].id!==run.id) throw new AttributionReview('RUN_CHANGED_DURING_WRITE');
      // Existing machine-based shift trigger remains intact; independent
      // ledger is authoritative for the cutter-specific Shift Count display.
    }
    if (prior) {
      await manager.query(`UPDATE public.dana_dsf_cutter_run_shifts_v1
         SET source_count=$4::bigint,run_count_after=$5::bigint,source_as_of=$6::timestamptz,
             updated_at=clock_timestamp()
         WHERE machine_id=$1::uuid AND run_id=$2::uuid AND shift_start=$3::timestamptz`,
        [item.machine_id,run.id,canonicalShiftStart,desired,after,cache.as_of]);
    } else {
      await manager.query(`INSERT INTO public.dana_dsf_cutter_run_shifts_v1
         (machine_id,run_id,shift_start,shift_number,source_count,run_count_after,source_as_of)
         VALUES ($1::uuid,$2::uuid,$3::timestamptz,$4::smallint,$5::bigint,$6::bigint,$7::timestamptz)`,
        [item.machine_id,run.id,canonicalShiftStart,cache.shift.number,desired,after,cache.as_of]);
    }
    return {status: delta?'APPLIED':'NO_CHANGE',reason:justSeeded?'ACTIVATION_BASELINE':'DSF_CYCLE_ATTRIBUTION'};
  });
}
