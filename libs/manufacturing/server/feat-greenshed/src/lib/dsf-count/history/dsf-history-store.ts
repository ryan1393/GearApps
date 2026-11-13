import { BadRequestException } from '@nestjs/common';
import type { DsfHistoryRecord, DsfHistoryReport, DsfHistorySource } from '@meshforge/shared/domain';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { isoUs, timestampUs } from '../dsf-core';
import type { HistoryCapture, HistoryPlan, HistoryReportQuery, HistorySource } from './dsf-history-model';
import { DSF_HISTORY_COLUMNS, ensureDsfHistorySchema } from './dsf-history-schema';

export const HISTORY_ROW_LIMIT = 5000;
const HOUR_US = 3600000000n;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const UTC = (field: string) => `to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const ZONE = 'America/Indiana/Indianapolis' as const;
export const historyHourStart = (at: string): string => isoUs(timestampUs(at) / HOUR_US * HOUR_US);

export interface HistoryStoredStatus {
  system_key: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_code: string | null;
  backfill_start: string;
  next_backfill_hour: string;
  source_count: number;
  active_source_count: number;
  issue_count: number;
  earliest_hour: string | null;
  latest_covered_to: string | null;
}
interface HistoryReportSqlRow {
  source_key: string;
  source_name: string;
  department_id: string | null;
  department_name: string;
  machine_number: string | null;
  asset_number: string | null;
  duplicate_operation: boolean;
  review_reason: string | null;
  period_start: string;
  period_end: string;
  known_count: string | null;
  covered_seconds: string;
  expected_seconds: string;
  observed_at: string | null;
  shift_id: string | null;
  shift_number: number | null;
  shift_date: string | null;
  completeness: DsfHistoryRecord['completeness'];
}

const integer = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('HISTORY_COUNT_PRECISION');
  return number;
};
const sameTime = (left: string, right: string) => timestampUs(left) === timestampUs(right);

/** Validate staged data before starting a local write transaction. */
export function validateHistoryCapture(capture: HistoryCapture): void {
  if (!HASH.test(capture.system_key) || !capture.sources.length || capture.sources.length > 5000 || capture.hours.length > 15000) {
    throw new Error('HISTORY_CAPTURE_SHAPE');
  }
  const at = timestampUs(capture.source_as_of);
  const sources = new Map<string, HistorySource>();
  const mappings = new Set<string>();
  for (const source of capture.sources) {
    if (!HASH.test(source.source_key) || source.system_key !== capture.system_key || sources.has(source.source_key) || mappings.has(source.mapping_id) ||
        ![source.mapping_id, source.whiteboard_id, source.op_id, source.line_id].every(value => UUID.test(value)) ||
        source.department_id !== null && !UUID.test(source.department_id) ||
        ![source.source_name, source.line_name, source.department_name].every(value => typeof value === 'string' && value.length <= 500)) {
      throw new Error('HISTORY_SOURCE_SHAPE');
    }
    sources.set(source.source_key, source);
    mappings.add(source.mapping_id);
  }
  const seen = new Set<string>();
  for (const hour of capture.hours) {
    const start = timestampUs(hour.hour_start), end = timestampUs(hour.covered_to);
    const key = hour.source_key + ':' + start;
    if (!sources.has(hour.source_key) || seen.has(key) || start % HOUR_US !== 0n || end <= start || end > start + HOUR_US || end > at) {
      throw new Error('HISTORY_WINDOW_SHAPE');
    }
    integer(hour.count); integer(hour.source_rows);
    if (hour.last_production_at && (timestampUs(hour.last_production_at) < start || timestampUs(hour.last_production_at) >= end)) {
      throw new Error('HISTORY_EVENT_OUTSIDE_WINDOW');
    }
    let position = start, count = 0;
    for (const slice of [...hour.slices].sort((a, b) => timestampUs(a.slice_start) < timestampUs(b.slice_start) ? -1 : 1)) {
      const sliceStart = timestampUs(slice.slice_start), sliceEnd = timestampUs(slice.slice_end);
      if (slice.source_key !== hour.source_key || !sameTime(slice.hour_start, hour.hour_start) || sliceStart !== position || sliceEnd <= sliceStart || sliceEnd > end) {
        throw new Error('HISTORY_SLICE_COVERAGE');
      }
      const fields = [slice.shift_id, slice.shift_number, slice.shift_date, slice.shift_start, slice.shift_end];
      if (slice.shift_id === null) {
        if (fields.some(value => value !== null)) throw new Error('HISTORY_SHIFT_SHAPE');
      } else {
        if (fields.some(value => value === null) || slice.shift_number===null || !Number.isSafeInteger(slice.shift_number) || slice.shift_number < 1 ||
            slice.shift_start===null || slice.shift_end===null || timestampUs(slice.shift_start)>sliceStart || timestampUs(slice.shift_end)<sliceEnd) {
          throw new Error('HISTORY_SHIFT_SHAPE');
        }
      }
      count += integer(slice.count);
      if (!Number.isSafeInteger(count)) throw new Error('HISTORY_COUNT_PRECISION');
      position = sliceEnd;
    }
    if (position !== end || count !== hour.count) throw new Error('HISTORY_SLICE_COVERAGE');
    seen.add(key);
  }
  if (!sameTime(historyHourStart(capture.backfill_start), capture.backfill_start) ||
      !sameTime(historyHourStart(capture.next_backfill_hour), capture.next_backfill_hour) ||
      timestampUs(capture.backfill_start)>timestampUs(historyHourStart(capture.source_as_of)) ||
      timestampUs(capture.next_backfill_hour)<timestampUs(capture.backfill_start) ||
      timestampUs(capture.next_backfill_hour) > at + HOUR_US) throw new Error('HISTORY_CURSOR_SHAPE');
  for (const issue of capture.issues) {
    if (issue.source_key !== null && !sources.has(issue.source_key) || !/^[A-Z0-9_]{2,80}$/.test(issue.code) ||
        !sameTime(historyHourStart(issue.hour_start), issue.hour_start)) throw new Error('HISTORY_ISSUE_SHAPE');
  }
}

export function historyReportTotals(rows: DsfHistoryRecord[], knownCounts: number[], truncated: boolean): DsfHistoryReport['totals'] {
  const totals = { count: null as number | null, known_subtotal: 0, complete_records: 0, partial_records: 0,
    unknown_records: 0, review_records: 0, excluded_duplicate_sources: 0 };
  const duplicates = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.duplicate_operation) duplicates.add(row.source_key);
    if (row.completeness === 'COMPLETE') totals.complete_records++;
    else if (row.completeness === 'PARTIAL') totals.partial_records++;
    else if (row.completeness === 'REVIEW') totals.review_records++;
    else totals.unknown_records++;
    if (!row.duplicate_operation && row.completeness !== 'REVIEW') {
      totals.known_subtotal += knownCounts[index];
      if (!Number.isSafeInteger(totals.known_subtotal)) throw new BadRequestException('The requested total exceeds supported precision; narrow the filters.');
    }
  }
  totals.excluded_duplicate_sources = duplicates.size;
  if (rows.length && !truncated && !totals.partial_records && !totals.unknown_records && !totals.review_records && !duplicates.size) {
    totals.count = totals.known_subtotal;
  }
  return totals;
}

/** All queries here use the application's injected DataSource, never a DSF client. */
export class DsfHistoryStore {
  constructor(private readonly db: DataSource) {}

  async available(): Promise<boolean> {
    if (this.db.options.type !== 'postgres') return false;
    const rows = await this.db.query(`SELECT count(*)::int=$2::int AS installed FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relkind='r' AND c.relname=ANY($1::text[])`, [Object.keys(DSF_HISTORY_COLUMNS), Object.keys(DSF_HISTORY_COLUMNS).length]);
    return rows[0]?.installed === true;
  }

  ensure(): Promise<void> { return ensureDsfHistorySchema(this.db); }

  async plan(at: string, systemKey: string, lookbackDays: number): Promise<HistoryPlan> {
    if (!HASH.test(systemKey) || !Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 31) throw new Error('HISTORY_PLAN_SHAPE');
    const now = timestampUs(historyHourStart(at));
    const rollingStart = now - BigInt(lookbackDays) * 24n * HOUR_US;
    const rows = await this.db.query(`SELECT ${UTC('backfill_start')} AS backfill_start,
      ${UTC('next_backfill_hour')} AS next_backfill_hour FROM public.dana_dsf_history_state_v1 WHERE system_key=$1`, [systemKey]);
    const stored = rows[0]?.next_backfill_hour as string | undefined;
    // A cursor behind the rolling lookback is retained after an outage. Never skip the gap.
    const next = stored && timestampUs(stored) < now ? timestampUs(stored) : rollingStart;
    const start = rows[0]?.backfill_start && stored && timestampUs(stored) < now
      ? timestampUs(rows[0].backfill_start) : rollingStart;
    return { system_key: systemKey, backfill_start: isoUs(start), backfill_hour: isoUs(next),
      hours: [...new Set([isoUs(now), isoUs(now - HOUR_US), isoUs(next)])] };
  }

  async commit(input: HistoryCapture): Promise<void> {
    validateHistoryCapture(input);
    await this.db.transaction(async manager => {
      let capture=input;
      await manager.query("SET LOCAL lock_timeout='2s'");
      await manager.query("SET LOCAL statement_timeout='10s'");
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('dana-dsf-history-v1'),hashtext($1))", [capture.system_key]);
      const states = await manager.query(`SELECT ${UTC('source_as_of')} AS source_as_of,
        ${UTC('next_backfill_hour')} AS next_backfill_hour FROM public.dana_dsf_history_state_v1
        WHERE system_key=$1 FOR UPDATE`, [capture.system_key]);
      if (states[0]?.source_as_of && timestampUs(states[0].source_as_of) > timestampUs(capture.source_as_of)) return;

      const prior = await manager.query(`SELECT source_key,mapping_id::text,current,
        ${UTC('first_seen_at')} AS first_seen_at,${UTC('current_since')} AS current_since
        FROM public.dana_dsf_history_source_v1 WHERE system_key=$1 AND mapping_id=ANY($2::uuid[])`,
        [capture.system_key,capture.sources.map(source=>source.mapping_id)]) as Array<{
          source_key:string;mapping_id:string;current:boolean;first_seen_at:string;current_since:string;
        }>;
      const lowerBounds=new Map<string,bigint>();
      for (const source of capture.sources) {
        const related=prior.filter(row=>row.mapping_id===source.mapping_id);
        if (!related.some(row=>row.source_key!==source.source_key)) continue;
        const exact=related.find(row=>row.source_key===source.source_key);
        // A previously seen identity can return later. Its original first_seen_at
        // cannot establish ownership through the intervening identity's time span.
        const since=exact?.current?exact.current_since:capture.source_as_of;
        lowerBounds.set(source.source_key,timestampUs(since));
      }
      const identityIssues=capture.hours.filter(hour=>{
        const bound=lowerBounds.get(hour.source_key);
        return bound!==undefined && timestampUs(hour.hour_start)<bound;
      }).map(hour=>({source_key:hour.source_key,hour_start:hour.hour_start,code:'HISTORY_IDENTITY_CHANGE_WINDOW'}));
      if (identityIssues.length) {
        const blocked=new Set(identityIssues.map(issue=>issue.source_key+':'+timestampUs(issue.hour_start)));
        capture={...capture,hours:capture.hours.filter(hour=>!blocked.has(hour.source_key+':'+timestampUs(hour.hour_start))),
          issues:[...capture.issues,...identityIssues]};
      }
      const uniqueIssues=new Map(capture.issues.map(issue=>[
        (issue.source_key??'')+':'+timestampUs(issue.hour_start)+':'+issue.code,issue,
      ]));
      capture={...capture,issues:[...uniqueIssues.values()]};
      await manager.query(`UPDATE public.dana_dsf_history_source_v1 SET current=false
        WHERE system_key=$1 AND last_seen_at<=$2::timestamptz AND NOT (source_key=ANY($3::text[]))`,
        [capture.system_key,capture.source_as_of,capture.sources.map(source=>source.source_key)]);
      await manager.query(`INSERT INTO public.dana_dsf_history_source_v1
        (source_key,system_key,mapping_id,whiteboard_id,op_id,line_id,department_id,source_name,line_name,department_name,
         asset_number,active,current,duplicate_operation,review_reason,first_seen_at,last_seen_at,current_since)
        SELECT source_key,system_key,mapping_id,whiteboard_id,op_id,line_id,department_id,source_name,line_name,department_name,
         asset_number,active,true,duplicate_operation,review_reason,$2::timestamptz,$2::timestamptz,$2::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS x(source_key text,system_key text,mapping_id uuid,whiteboard_id uuid,
         op_id uuid,line_id uuid,department_id uuid,source_name text,line_name text,department_name text,asset_number text,
         active boolean,duplicate_operation boolean,review_reason text)
        ON CONFLICT (source_key) DO UPDATE SET source_name=EXCLUDED.source_name,line_name=EXCLUDED.line_name,
         department_name=EXCLUDED.department_name,asset_number=EXCLUDED.asset_number,active=EXCLUDED.active,current=true,
         duplicate_operation=EXCLUDED.duplicate_operation,review_reason=EXCLUDED.review_reason,last_seen_at=EXCLUDED.last_seen_at,
         current_since=CASE WHEN dana_dsf_history_source_v1.current THEN dana_dsf_history_source_v1.current_since ELSE EXCLUDED.current_since END
        WHERE EXCLUDED.last_seen_at>=dana_dsf_history_source_v1.last_seen_at`, [JSON.stringify(capture.sources), capture.source_as_of]);

      const sources = new Map(capture.sources.map(source => [source.source_key, source]));
      const hours = capture.hours.map(hour => {
        const source = sources.get(hour.source_key);
        if (!source) throw new Error('HISTORY_SOURCE_SHAPE');
        const content = { ...hour, slices: [...hour.slices].sort((a,b) => timestampUs(a.slice_start)<timestampUs(b.slice_start)?-1:1),
          duplicate_operation: source.duplicate_operation, review_reason: source.review_reason };
        return { ...hour, slices: undefined, duplicate_operation: source.duplicate_operation, review_reason: source.review_reason,
          content_hash: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
      });
      const incoming = `jsonb_to_recordset($1::jsonb) AS x(source_key text,hour_start timestamptz,covered_to timestamptz,
        count bigint,source_rows bigint,last_production_at timestamptz,content_hash text,duplicate_operation boolean,review_reason text)`;
      if (hours.length) {
        await manager.query(`INSERT INTO public.dana_dsf_history_revision_v1
          (source_key,hour_start,previous_count,new_count,previous_hash,new_hash,previous_source_as_of,new_source_as_of)
          SELECT h.source_key,h.hour_start,h.count,x.count,h.content_hash,x.content_hash,h.source_as_of,$2::timestamptz
          FROM public.dana_dsf_history_hour_v1 h JOIN ${incoming} ON h.source_key=x.source_key AND h.hour_start=x.hour_start
          WHERE h.covered_to=h.hour_start+interval '1 hour' AND h.content_hash<>x.content_hash
            AND h.source_as_of<=$2::timestamptz AND h.covered_to<=x.covered_to`, [JSON.stringify(hours), capture.source_as_of]);
      }
      const accepted = hours.length ? await manager.query(`INSERT INTO public.dana_dsf_history_hour_v1
        (source_key,hour_start,covered_to,count,source_rows,last_production_at,source_as_of,content_hash,duplicate_operation,review_reason)
        SELECT source_key,hour_start,covered_to,count,source_rows,last_production_at,$2::timestamptz,content_hash,duplicate_operation,review_reason
        FROM ${incoming}
        ON CONFLICT (source_key,hour_start) DO UPDATE SET covered_to=EXCLUDED.covered_to,count=EXCLUDED.count,
         source_rows=EXCLUDED.source_rows,last_production_at=EXCLUDED.last_production_at,source_as_of=EXCLUDED.source_as_of,
         captured_at=clock_timestamp(),revision=dana_dsf_history_hour_v1.revision+
           CASE WHEN dana_dsf_history_hour_v1.content_hash<>EXCLUDED.content_hash THEN 1 ELSE 0 END,
         content_hash=EXCLUDED.content_hash,duplicate_operation=EXCLUDED.duplicate_operation,review_reason=EXCLUDED.review_reason
        WHERE EXCLUDED.source_as_of>=dana_dsf_history_hour_v1.source_as_of
          AND EXCLUDED.covered_to>=dana_dsf_history_hour_v1.covered_to
        RETURNING source_key,${UTC('hour_start')} AS hour_start`, [JSON.stringify(hours), capture.source_as_of]) : [];
      const acceptedKeys = new Set(accepted.map((row: {source_key:string;hour_start:string}) => row.source_key+':'+timestampUs(row.hour_start)));
      const acceptedHours = capture.hours.filter(hour => acceptedKeys.has(hour.source_key+':'+timestampUs(hour.hour_start)));
      if (acceptedHours.length) {
        const keys = JSON.stringify(acceptedHours.map(hour => ({source_key:hour.source_key,hour_start:hour.hour_start})));
        await manager.query(`DELETE FROM public.dana_dsf_history_slice_v1 h USING
          jsonb_to_recordset($1::jsonb) AS x(source_key text,hour_start timestamptz)
          WHERE h.source_key=x.source_key AND h.hour_start=x.hour_start`, [keys]);
        await manager.query(`DELETE FROM public.dana_dsf_history_issue_v1 h USING
          jsonb_to_recordset($1::jsonb) AS x(source_key text,hour_start timestamptz)
          WHERE h.system_key=$2 AND h.source_key=x.source_key AND h.hour_start=x.hour_start`, [keys,capture.system_key]);
        await manager.query(`INSERT INTO public.dana_dsf_history_slice_v1
          (source_key,hour_start,slice_start,slice_end,shift_id,shift_number,shift_date,shift_start,shift_end,count)
          SELECT source_key,hour_start,slice_start,slice_end,shift_id,shift_number,shift_date,shift_start,shift_end,count
          FROM jsonb_to_recordset($1::jsonb) AS x(source_key text,hour_start timestamptz,slice_start timestamptz,slice_end timestamptz,
            shift_id text,shift_number integer,shift_date date,shift_start timestamptz,shift_end timestamptz,count bigint)`,
          [JSON.stringify(acceptedHours.flatMap(hour => hour.slices))]);
        const cleared = [...new Set(acceptedHours.map(hour => hour.hour_start))].filter(hour =>
          !capture.issues.some(issue => issue.source_key===null && sameTime(issue.hour_start,hour)));
        if (cleared.length) await manager.query(`DELETE FROM public.dana_dsf_history_issue_v1
          WHERE system_key=$1 AND source_key='' AND hour_start=ANY($2::timestamptz[])`, [capture.system_key,cleared]);
      }
      if (capture.issues.length) await manager.query(`INSERT INTO public.dana_dsf_history_issue_v1
        (system_key,source_key,hour_start,code,observed_at)
        SELECT $2,COALESCE(source_key,''),hour_start,code,$3::timestamptz FROM
        jsonb_to_recordset($1::jsonb) AS x(source_key text,hour_start timestamptz,code text)
        ON CONFLICT (system_key,source_key,hour_start,code) DO UPDATE SET observed_at=EXCLUDED.observed_at`,
        [JSON.stringify(capture.issues),capture.system_key,capture.source_as_of]);

      const nowHour = timestampUs(historyHourStart(capture.source_as_of));
      const previousCursor = states[0]?.next_backfill_hour as string | undefined;
      const backfill = previousCursor && timestampUs(previousCursor) < nowHour ? previousCursor : capture.backfill_start;
      let next = capture.next_backfill_hour;
      if (timestampUs(next)<timestampUs(backfill)) next=backfill;
      if (timestampUs(next) > timestampUs(backfill)) {
        // This is scan progress, never a completeness watermark. Scoped failures remain
        // explicit issues while healthy sources continue; a failed global read cannot advance.
        const complete = timestampUs(next) === timestampUs(backfill)+HOUR_US &&
          !capture.issues.some(issue => issue.source_key===null && sameTime(issue.hour_start,backfill));
        if (!complete) next = backfill;
      }
      await manager.query(`INSERT INTO public.dana_dsf_history_state_v1
        (system_key,backfill_start,next_backfill_hour,source_as_of,last_success_at)
        VALUES ($1,$2::timestamptz,$3::timestamptz,$4::timestamptz,CASE WHEN $5::boolean THEN clock_timestamp() ELSE NULL END)
        ON CONFLICT (system_key) DO UPDATE SET backfill_start=EXCLUDED.backfill_start,next_backfill_hour=EXCLUDED.next_backfill_hour,
         source_as_of=EXCLUDED.source_as_of,last_success_at=COALESCE(EXCLUDED.last_success_at,dana_dsf_history_state_v1.last_success_at),
         last_failure_at=NULL,last_failure_code=NULL,updated_at=clock_timestamp()`,
        [capture.system_key,capture.backfill_start,next,capture.source_as_of,acceptedHours.length>0]);
    });
  }

  async failure(systemKey: string, code: string, at = new Date().toISOString()): Promise<void> {
    if (!HASH.test(systemKey) || !/^[A-Z0-9_]{2,80}$/.test(code)) return;
    await this.db.query(`UPDATE public.dana_dsf_history_state_v1
      SET last_failure_at=$2::timestamptz,last_failure_code=$3,updated_at=clock_timestamp() WHERE system_key=$1`, [systemKey,at,code]);
  }

  async status(systemKey?: string): Promise<HistoryStoredStatus | null> {
    const rows = await this.db.query(`SELECT st.system_key,${UTC('st.last_success_at')} AS last_success_at,
      ${UTC('st.last_failure_at')} AS last_failure_at,st.last_failure_code,
      ${UTC('st.backfill_start')} AS backfill_start,${UTC('st.next_backfill_hour')} AS next_backfill_hour,
      (SELECT count(*)::int FROM public.dana_dsf_history_source_v1 s WHERE s.system_key=st.system_key AND s.current) AS source_count,
      (SELECT count(*)::int FROM public.dana_dsf_history_source_v1 s WHERE s.system_key=st.system_key AND s.current AND s.active) AS active_source_count,
      (SELECT count(*)::int FROM public.dana_dsf_history_issue_v1 issue WHERE issue.system_key=st.system_key) AS issue_count,
      (SELECT ${UTC('min(h.hour_start)')} FROM public.dana_dsf_history_hour_v1 h JOIN public.dana_dsf_history_source_v1 s ON s.source_key=h.source_key WHERE s.system_key=st.system_key) AS earliest_hour,
      (SELECT ${UTC('max(h.covered_to)')} FROM public.dana_dsf_history_hour_v1 h JOIN public.dana_dsf_history_source_v1 s ON s.source_key=h.source_key WHERE s.system_key=st.system_key) AS latest_covered_to
      FROM public.dana_dsf_history_state_v1 st WHERE ($1::text IS NULL OR st.system_key=$1)
      ORDER BY st.updated_at DESC LIMIT 1`, [systemKey??null]);
    return rows[0] as HistoryStoredStatus??null;
  }

  private async sourceJoin(): Promise<{join:string;fields:string}> {
    const installed = await this.db.query(`SELECT to_regclass('public.dana_dsf_machine_mapping_v1') IS NOT NULL AS installed,
      to_regclass('lapper.machines') IS NOT NULL AS lapper_installed`);
    return installed[0]?.installed===true ? {
      join:`LEFT JOIN public.dana_dsf_machine_mapping_v1 approved ON approved.enabled AND s.current
        AND approved.mapping_id=s.mapping_id AND approved.whiteboard_id=s.whiteboard_id AND approved.op_id=s.op_id
        AND approved.line_id=s.line_id AND approved.department_id=s.department_id
        AND approved.line_name=s.line_name AND approved.whiteboard_name=s.source_name
        LEFT JOIN public.machines machine ON machine.id=approved.machine_id AND machine."deletedAt" IS NULL
          ${installed[0]?.lapper_installed===true?'AND NOT EXISTS (SELECT 1 FROM lapper.machines profile WHERE profile.public_machine_id=machine.id)':''}
          AND EXISTS (SELECT 1 FROM public.departments department WHERE department.id=machine.department_id
            AND department.code=approved.source_department AND department."deletedAt" IS NULL)`,
      fields:`machine.id::text AS machine_id,btrim(machine.machine_number) AS machine_number`,
    } : {join:'',fields:'NULL::text AS machine_id,NULL::text AS machine_number'};
  }

  async sources(includeInactive=false, systemKey?: string): Promise<DsfHistorySource[]> {
    const link = await this.sourceJoin();
    const rows = await this.db.query(`SELECT s.source_key,s.mapping_id::text,s.whiteboard_id::text,s.op_id::text,s.line_id::text,
      s.department_id::text,s.source_name,s.line_name,s.department_name,s.asset_number,s.active,s.current,
      s.duplicate_operation,s.review_reason,${UTC('s.last_seen_at')} AS last_seen_at,${link.fields}
      FROM public.dana_dsf_history_source_v1 s ${link.join}
      WHERE ($1::boolean OR (s.current AND s.active))
        AND s.system_key=COALESCE($2::text,(SELECT system_key FROM public.dana_dsf_history_state_v1 ORDER BY updated_at DESC LIMIT 1))
      ORDER BY s.department_name,s.source_name,s.source_key LIMIT 5001`, [includeInactive,systemKey??null]);
    if (rows.length>5000) throw new Error('HISTORY_SOURCE_LIMIT');
    return rows as DsfHistorySource[];
  }

  async report(query: HistoryReportQuery, systemKey?: string): Promise<DsfHistoryReport> {
    validateHistoryReportQuery(query);
    const link = await this.sourceJoin();
    const parameters = [query.from,query.to,query.source_key??null,query.department_id??null,query.include_inactive,systemKey??null];
    const sourceSql = `SELECT s.*,${link.fields} FROM public.dana_dsf_history_source_v1 s ${link.join}
      WHERE ($3::text IS NULL OR s.source_key=$3) AND ($4::uuid IS NULL OR s.department_id=$4::uuid)
       AND ($5::boolean OR (s.current AND s.active))
       AND s.system_key=COALESCE($6::text,(SELECT system_key FROM public.dana_dsf_history_state_v1 ORDER BY updated_at DESC LIMIT 1))`;
    const rows = await this.db.transaction(async manager => {
      await manager.query("SET LOCAL statement_timeout='5s'");
      await manager.query("SET LOCAL lock_timeout='1s'");
      await manager.query('SET LOCAL jit=off');
      await manager.query("SET LOCAL TIME ZONE 'UTC'");
      return manager.query(query.group==='shift' ? shiftReportSql(sourceSql) : periodReportSql(sourceSql,query.group),parameters);
    }) as HistoryReportSqlRow[];
    const truncated = rows.length>HISTORY_ROW_LIMIT;
    const visible = rows.slice(0,HISTORY_ROW_LIMIT);
    const knownCounts = visible.map(row => row.known_count===null?0:integer(row.known_count));
    const records = visible.map((row): DsfHistoryRecord => ({
      source_key:row.source_key,source_name:row.source_name,department_id:row.department_id,department_name:row.department_name,
      machine_number:row.machine_number,asset_number:row.asset_number,duplicate_operation:row.duplicate_operation,
      review_reason:row.review_reason,period_start:row.period_start,period_end:row.period_end,
      count:row.completeness==='UNKNOWN'?null:row.known_count===null?null:integer(row.known_count),
      completeness:row.completeness,covered_seconds:Number(row.covered_seconds),expected_seconds:Number(row.expected_seconds),
      observed_at:row.observed_at,shift_id:row.shift_id,shift_number:row.shift_number,shift_date:row.shift_date,
    }));
    return {format:'DSFHISTORY1',available:true,served_at:new Date().toISOString(),timezone:ZONE,
      from:query.from,to:query.to,group:query.group,rows:records,truncated,row_limit:HISTORY_ROW_LIMIT,
      totals:historyReportTotals(records,knownCounts,truncated),
      note:'Recorded RUN pieces across DSF operations; sequential operations can count the same physical part. Missing coverage is unknown. Duplicate-operation sources are excluded from totals.'};
  }
}

export function validateHistoryReportQuery(query: HistoryReportQuery): void {
  const civil = (value: string) => /^\d{4}-\d\d-\d\d$/.test(value) && Number(value.slice(0,4))>0 &&
    Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if (!civil(query.from) || !civil(query.to) || query.from>query.to ||
      Date.parse(query.to)-Date.parse(query.from)>30*86400000 || !['hour','shift','day'].includes(query.group) ||
      query.source_key!==undefined&&!HASH.test(query.source_key) || query.department_id!==undefined&&!UUID.test(query.department_id) ||
      typeof query.include_inactive!=='boolean') throw new BadRequestException('Use valid dates spanning at most 31 days and supported history filters.');
}

const REPORT_COMMON = (sourceSql:string) => `WITH bounds AS (
  SELECT $1::date::timestamp AT TIME ZONE '${ZONE}' AS from_at,($2::date+1)::timestamp AT TIME ZONE '${ZONE}' AS to_at
), days AS (SELECT d::date AS day FROM generate_series($1::date,$2::date,interval '1 day') d),
sources AS (${sourceSql})`;
const recordColumns = `source_key,source_name,department_id::text,department_name,machine_number,asset_number,duplicate_operation,review_reason,
 ${UTC('period_start')} AS period_start,${UTC('period_end')} AS period_end,known_count::text,covered_seconds::text,expected_seconds::text,
 ${UTC('observed_at')} AS observed_at,shift_id,shift_number,shift_date::text`;

function periodReportSql(sourceSql:string,group:'hour'|'day'):string {
  const periods = group==='hour'
    ? `SELECT p AS period_start,p+interval '1 hour' AS period_end FROM bounds,
      generate_series(bounds.from_at,bounds.to_at-interval '1 hour',interval '1 hour') p`
    : `SELECT day::timestamp AT TIME ZONE '${ZONE}' AS period_start,(day+1)::timestamp AT TIME ZONE '${ZONE}' AS period_end FROM days`;
  return `${REPORT_COMMON(sourceSql)}, periods AS (${periods}), period_sources AS (
    SELECT * FROM sources ORDER BY source_name,source_key
    LIMIT (SELECT ((${HISTORY_ROW_LIMIT+1}+count(*)-1)/count(*))::integer FROM periods)
  ), report_windows AS MATERIALIZED (
    SELECT s.*,p.period_start,p.period_end FROM period_sources s CROSS JOIN periods p
    ORDER BY s.source_name,s.source_key,p.period_start LIMIT ${HISTORY_ROW_LIMIT+1}
  ), aggregated AS (
    SELECT s.source_key,s.source_name,s.department_id,s.department_name,s.machine_number,s.asset_number,
      s.duplicate_operation OR COALESCE(bool_or(h.duplicate_operation),false) AS duplicate_operation,
      COALESCE(s.review_reason,max(h.review_reason)) AS review_reason,p.period_start,p.period_end,
      sum(h.count) AS known_count,COALESCE(sum(extract(epoch FROM h.covered_to-h.hour_start)),0) AS covered_seconds,
      extract(epoch FROM p.period_end-p.period_start) AS expected_seconds,min(h.hour_start) AS coverage_start,max(h.covered_to) AS coverage_end,
      max(h.source_as_of) AS observed_at,
      EXISTS (SELECT 1 FROM public.dana_dsf_history_issue_v1 issue WHERE issue.system_key=s.system_key
        AND issue.source_key IN ('',s.source_key) AND issue.hour_start>=p.period_start AND issue.hour_start<p.period_end) AS has_issue
    FROM report_windows s CROSS JOIN LATERAL (SELECT s.period_start,s.period_end) p
    LEFT JOIN public.dana_dsf_history_hour_v1 h
      ON h.source_key=s.source_key AND h.hour_start>=p.period_start AND h.hour_start<p.period_end
    GROUP BY s.source_key,s.source_name,s.department_id,s.department_name,s.machine_number,s.asset_number,
      s.duplicate_operation,s.review_reason,s.system_key,p.period_start,p.period_end
  ) SELECT ${recordColumns},
    CASE WHEN duplicate_operation OR review_reason IS NOT NULL OR has_issue THEN 'REVIEW'
      WHEN known_count IS NULL THEN 'UNKNOWN'
      WHEN covered_seconds=expected_seconds THEN 'COMPLETE'
      WHEN coverage_start=period_start AND covered_seconds=extract(epoch FROM coverage_end-period_start) THEN 'PARTIAL'
      ELSE 'UNKNOWN' END AS completeness
    FROM aggregated CROSS JOIN LATERAL (SELECT NULL::text AS shift_id,NULL::integer AS shift_number,NULL::date AS shift_date) shift_fields
    ORDER BY source_name,source_key,period_start LIMIT ${HISTORY_ROW_LIMIT+1}`;
}

function shiftReportSql(sourceSql:string):string {
  return `${REPORT_COMMON(sourceSql)}, known_shifts AS (
    SELECT s.source_key,s.source_name,s.department_id,s.department_name,s.machine_number,s.asset_number,
      s.duplicate_operation OR bool_or(h.duplicate_operation) AS duplicate_operation,
      COALESCE(s.review_reason,max(h.review_reason),CASE WHEN EXISTS (
        SELECT 1 FROM public.dana_dsf_history_slice_v1 conflict WHERE conflict.source_key=s.source_key
          AND conflict.shift_id=sl.shift_id AND (conflict.shift_start IS DISTINCT FROM sl.shift_start OR conflict.shift_end IS DISTINCT FROM sl.shift_end)
      ) THEN 'SHIFT_BOUNDARY_CHANGED' END) AS review_reason,
      sl.shift_start AS period_start,sl.shift_end AS period_end,sum(sl.count) AS known_count,
      sum(extract(epoch FROM sl.slice_end-sl.slice_start)) AS covered_seconds,
      extract(epoch FROM sl.shift_end-sl.shift_start) AS expected_seconds,
      min(sl.slice_start) AS coverage_start,max(sl.slice_end) AS coverage_end,max(h.source_as_of) AS observed_at,
      sl.shift_id,sl.shift_number,sl.shift_date,
      EXISTS (SELECT 1 FROM public.dana_dsf_history_issue_v1 issue WHERE issue.system_key=s.system_key
        AND issue.source_key IN ('',s.source_key) AND issue.hour_start>=date_trunc('hour',sl.shift_start)
        AND issue.hour_start<sl.shift_end) AS has_issue
    FROM sources s JOIN public.dana_dsf_history_slice_v1 sl ON sl.source_key=s.source_key
      AND sl.shift_date BETWEEN $1::date AND $2::date
    JOIN public.dana_dsf_history_hour_v1 h ON h.source_key=sl.source_key AND h.hour_start=sl.hour_start
    GROUP BY s.source_key,s.source_name,s.department_id,s.department_name,s.machine_number,s.asset_number,
      s.duplicate_operation,s.review_reason,s.system_key,sl.shift_id,sl.shift_number,sl.shift_date,sl.shift_start,sl.shift_end
  ), daily_coverage AS (
    SELECT s.source_key,s.source_name,s.department_id,s.department_name,s.machine_number,s.asset_number,s.duplicate_operation,
      s.review_reason,day::timestamp AT TIME ZONE '${ZONE}' AS period_start,(day+1)::timestamp AT TIME ZONE '${ZONE}' AS period_end,
      COALESCE(sum(extract(epoch FROM h.covered_to-h.hour_start)),0) AS covered_seconds,
      extract(epoch FROM ((day+1)::timestamp AT TIME ZONE '${ZONE}')-(day::timestamp AT TIME ZONE '${ZONE}')) AS expected_seconds,
      max(h.source_as_of) AS observed_at,
      EXISTS (SELECT 1 FROM public.dana_dsf_history_slice_v1 u WHERE u.source_key=s.source_key AND u.shift_id IS NULL
        AND u.slice_start>=day::timestamp AT TIME ZONE '${ZONE}' AND u.slice_start<(day+1)::timestamp AT TIME ZONE '${ZONE}') AS has_unassigned
    FROM sources s CROSS JOIN days LEFT JOIN public.dana_dsf_history_hour_v1 h ON h.source_key=s.source_key
      AND h.hour_start>=day::timestamp AT TIME ZONE '${ZONE}' AND h.hour_start<(day+1)::timestamp AT TIME ZONE '${ZONE}'
    GROUP BY s.source_key,s.source_name,s.department_id,s.department_name,s.machine_number,s.asset_number,s.duplicate_operation,s.review_reason,day
  ), combined AS (
    SELECT ${recordColumns},CASE WHEN duplicate_operation OR review_reason IS NOT NULL OR has_issue THEN 'REVIEW'
      WHEN covered_seconds=expected_seconds THEN 'COMPLETE'
      WHEN coverage_start=period_start AND covered_seconds=extract(epoch FROM coverage_end-period_start) THEN 'PARTIAL'
      ELSE 'UNKNOWN' END AS completeness FROM known_shifts
    UNION ALL
    SELECT ${recordColumns},CASE WHEN duplicate_operation OR review_reason IS NOT NULL OR has_unassigned THEN 'REVIEW' ELSE 'UNKNOWN' END AS completeness
    FROM daily_coverage CROSS JOIN LATERAL (SELECT NULL::bigint AS known_count,NULL::text AS shift_id,NULL::integer AS shift_number,NULL::date AS shift_date) missing_fields
    WHERE covered_seconds<expected_seconds OR has_unassigned
  ) SELECT * FROM combined ORDER BY source_name,source_key,period_start,shift_number NULLS LAST LIMIT ${HISTORY_ROW_LIMIT+1}`;
}
