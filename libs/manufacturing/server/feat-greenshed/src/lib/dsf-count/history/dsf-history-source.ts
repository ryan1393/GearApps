import { createHash } from 'node:crypto';
import { chooseShift, DsfRefusal, DsfShiftRow, isoUs, timestampUs } from '../dsf-core';
import {
  HistoryCapture, HistoryHour, HistoryIssue, HistoryPlan, HistoryQueryClient,
  HistorySlice, HistorySource,
} from './dsf-history-model';

export const HISTORY_SOURCE_LIMIT = 5000;
export const HISTORY_EVENT_LIMIT = 200000;
export const HISTORY_AGGREGATE_LIMIT = 25000;
const HOUR_US = 3600000000n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

/** Complete catalog, including named areas and inactive alternatives. No machine whitelist. */
export const HISTORY_CATALOG_SQL = `WITH reason_counts AS (
 SELECT op_id,count(*) FILTER (WHERE code::text='1')::int AS running_reasons
 FROM public.tbl_op_state_reason GROUP BY op_id
)
SELECT wm.id::text AS mapping_id,wm.whiteboard_id::text,wm.op_id::text,wm.line_id::text,
 l.department_id::text AS department_id,left(btrim(w.name),501) AS source_name,left(btrim(l.name),501) AS line_name,
 left(btrim(d.name),501) AS department_name,left(COALESCE(NULLIF(btrim(o.asset_number),''),NULLIF(btrim(l.asset_number),'')),501) AS asset_number,
 wm.active AS mapping_active,w.active AS whiteboard_active,
 (o.line_id=wm.line_id AND w.id IS NOT NULL AND o.id IS NOT NULL AND l.id IS NOT NULL AND d.id IS NOT NULL) AS identity_valid,
 COALESCE(rc.running_reasons,0) AS running_reasons,
 count(*) FILTER (WHERE wm.active AND w.active) OVER (PARTITION BY wm.op_id)::int AS active_mappings
FROM public.tbl_whiteboard_machines wm
LEFT JOIN public.tbl_whiteboard w ON w.id=wm.whiteboard_id
LEFT JOIN public.tbl_op o ON o.id=wm.op_id
LEFT JOIN public.tbl_line l ON l.id=wm.line_id
LEFT JOIN public.tbl_department d ON d.id=l.department_id
LEFT JOIN reason_counts rc ON rc.op_id=wm.op_id
ORDER BY wm.id LIMIT 5001`;

/** Dated shifts only. Text schedule templates do not establish historical boundaries. */
export const HISTORY_SHIFTS_SQL = `SELECT s.line_id::text,s.id::text,s.shift AS number,
 to_char(s.start_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS starts_at,
 to_char(s.end_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ends_at,
 (s.start_time AT TIME ZONE 'America/Indiana/Indianapolis')::date::text AS local_date
FROM public.tbl_shift s WHERE s.line_id=ANY($1::uuid[])
 AND s.start_time >= $2::timestamptz - interval '32 hours'
 AND s.start_time <= $3::timestamptz + interval '32 hours'
ORDER BY s.line_id,s.start_time,s.id LIMIT 50001`;

/**
 * One bounded all-source scan per hour. Do not turn this into one scan per machine:
 * the exported master table only establishes its (id,timestamp) primary-key index.
 * The global sentinel makes a limited scan incomplete, never an invented zero.
 */
export const HISTORY_COUNTS_SQL = `WITH scope AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(source_key text,mapping_id uuid,whiteboard_id uuid,
 op_id uuid,slice_key integer,slice_start timestamptz,slice_end timestamptz)
), catalog AS MATERIALIZED (
 SELECT DISTINCT source_key,mapping_id,whiteboard_id,op_id FROM scope
), bounded AS MATERIALIZED (
 SELECT c.id,c.machine_id,c.whiteboard_id,c.code,c.part_count,c."timestamp"
 FROM public.tbl_whiteboard_cycles_master c
 WHERE c."timestamp">=$1::timestamptz AND c."timestamp"<$2::timestamptz
 LIMIT 200001
), result AS (
 SELECT 'TOTAL'::text AS kind,NULL::text AS source_key,NULL::integer AS slice_key,
 count(*)::text AS source_rows,count(DISTINCT (id,"timestamp"))::text AS distinct_rows,
 '0'::text AS count,'0'::text AS invalid_parts,'0'::text AS invalid_reason,
 '0'::text AS wrong_whiteboard,'0'::text AS missing_slice,NULL::text AS last_production_at
 FROM bounded
 UNION ALL
 SELECT 'SOURCE',m.source_key,s.slice_key,count(*)::text,NULL::text,
 COALESCE(sum(CASE WHEN r.code::text='1' AND r.op_id=m.op_id AND c.whiteboard_id=m.whiteboard_id THEN c.part_count ELSE 0 END),0)::text,
 count(*) FILTER (WHERE c.part_count IS NULL OR c.part_count<0)::text,
 count(*) FILTER (WHERE r.id IS NULL OR r.code IS NULL OR r.op_id IS DISTINCT FROM m.op_id)::text,
 count(*) FILTER (WHERE c.whiteboard_id IS DISTINCT FROM m.whiteboard_id)::text,
 count(*) FILTER (WHERE s.slice_key IS NULL)::text,
 to_char((max(c."timestamp") FILTER (WHERE r.code::text='1' AND r.op_id=m.op_id AND c.whiteboard_id=m.whiteboard_id)) AT TIME ZONE 'UTC',
   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 FROM bounded c LEFT JOIN catalog m ON m.mapping_id=c.machine_id
 LEFT JOIN scope s ON s.source_key=m.source_key AND c."timestamp">=s.slice_start AND c."timestamp"<s.slice_end
 LEFT JOIN public.tbl_op_state_reason r ON r.id=c.code
 GROUP BY m.source_key,s.slice_key
)
SELECT * FROM result ORDER BY CASE WHEN kind='TOTAL' THEN 0 ELSE 1 END,source_key,slice_key LIMIT 25002`;

/** Credentials and logins deliberately do not participate in the source-system key. */
export function dsfHistorySystemKey(client: Record<string, unknown>): string {
  const host = client['host'], database = client['database'], port = Number(client['port'] ?? 5432);
  if (typeof host !== 'string' || !host.trim() || typeof database !== 'string' || !database.trim() ||
      !Number.isInteger(port) || port < 1 || port > 65535) throw new DsfRefusal('HISTORY_SOURCE_SYSTEM');
  return hash([host.startsWith('/') ? host.trim() : host.trim().toLowerCase(), port, database]);
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer = (value: unknown): number => {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value))) throw new DsfRefusal('HISTORY_INVALID_COUNT');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new DsfRefusal('HISTORY_COUNT_OVERFLOW');
  return number;
};
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** A changed identity creates a different stream; earlier history is never relabelled. */
export function historySources(rows: unknown[], systemKey: string): HistorySource[] {
  if (!HASH.test(systemKey) || rows.length > HISTORY_SOURCE_LIMIT) throw new DsfRefusal('HISTORY_CATALOG_LIMIT');
  const seen = new Set<string>();
  return rows.map(raw => {
    const row = raw as Record<string, unknown>;
    if (!row || ![row['mapping_id'], row['whiteboard_id'], row['op_id'], row['line_id']].every(uuid) ||
        (row['department_id'] !== null && !uuid(row['department_id']))) throw new DsfRefusal('HISTORY_CATALOG_IDENTITY');
    const mappingId = String(row['mapping_id']).toLowerCase();
    if (seen.has(mappingId)) throw new DsfRefusal('HISTORY_CATALOG_DUPLICATE_KEY');
    seen.add(mappingId);
    const text = (key: string): string => typeof row[key] === 'string' ? (row[key] as string).trim() : '';
    const sourceName = text('source_name'), lineName = text('line_name'), departmentName = text('department_name');
    const assetNumber = text('asset_number');
    const oversized = [sourceName, lineName, departmentName, assetNumber].some(value => value.length > 500);
    const display = (value: string): string => value.slice(0, 500).replace(/[\uD800-\uDBFF]$/, '');
    const opId = String(row['op_id']).toLowerCase(), lineId = String(row['line_id']).toLowerCase();
    const whiteboardId = String(row['whiteboard_id']).toLowerCase();
    const departmentId = row['department_id'] === null ? null : String(row['department_id']).toLowerCase();
    const activeMappings = integer(row['active_mappings']);
    const duplicate = activeMappings > 1 && row['mapping_active'] === true && row['whiteboard_active'] === true;
    const invalid = row['identity_valid'] !== true || oversized || !sourceName || !lineName || !departmentName ||
      departmentId === null || typeof row['mapping_active'] !== 'boolean' || typeof row['whiteboard_active'] !== 'boolean';
    const review = invalid ? 'INVALID_SOURCE_IDENTITY' : integer(row['running_reasons']) < 1 ? 'NO_RUN_REASON' :
      duplicate ? 'DUPLICATE_OPERATION' : null;
    return {
      source_key: hash([systemKey, mappingId, whiteboardId, opId, lineId, departmentId]), system_key: systemKey,
      mapping_id: mappingId, whiteboard_id: whiteboardId, op_id: opId, line_id: lineId, department_id: departmentId,
      source_name: display(sourceName) || mappingId, line_name: display(lineName), department_name: display(departmentName),
      asset_number: display(assetNumber) || null,
      active: row['mapping_active'] === true && row['whiteboard_active'] === true,
      duplicate_operation: duplicate, review_reason: review,
    };
  });
}

export interface HistoryShiftRow extends DsfShiftRow { line_id: string; }

/** Partition an hour using actual shift boundaries; gaps/overlaps remain unassigned. */
export function historyShiftSlices(source: HistorySource, hour: string, until: string, rows: HistoryShiftRow[]): HistorySlice[] {
  const lo = timestampUs(hour), hi = timestampUs(until);
  if (hi <= lo || hi - lo > HOUR_US) throw new DsfRefusal('HISTORY_INVALID_WINDOW');
  const own = rows.filter(row => row.line_id === source.line_id);
  const boundaries = new Set<bigint>([lo, hi]);
  let valid = own.length <= 12;
  for (const row of own) {
    try {
      if (!/^\d+$/.test(String(row.id)) || !Number.isInteger(row.number) || row.number < 1 || row.number > 32767 ||
          !/^\d{4}-\d\d-\d\d$/.test(row.local_date)) throw new DsfRefusal('INVALID_SHIFT');
      const start = timestampUs(row.starts_at), end = timestampUs(row.ends_at);
      if (end <= start || end - start > 26n * HOUR_US) throw new DsfRefusal('INVALID_SHIFT');
      const next = own.map(other => timestampUs(other.starts_at)).filter(t => t > start).sort((a,b) => a < b ? -1 : 1)[0];
      const effectiveEnd = next !== undefined && (next === end || next === end + 1000000n) ? next : end;
      if (start > lo && start < hi) boundaries.add(start);
      if (effectiveEnd > lo && effectiveEnd < hi) boundaries.add(effectiveEnd);
    } catch { valid = false; }
  }
  const sorted = valid ? [...boundaries].sort((a,b) => a < b ? -1 : 1) : [lo, hi];
  const slices: HistorySlice[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const start = sorted[index], end = sorted[index + 1];
    let shift: ReturnType<typeof chooseShift> | null = null;
    if (valid) {
      try { shift = chooseShift(own, isoUs(start + (end - start) / 2n)); }
      catch { /* A missing or overlapping dated shift is unknown, never an invented schedule. */ }
    }
    const previous = slices.at(-1);
    if (previous && previous.shift_id === (shift?.id ?? null) && previous.shift_start === (shift?.starts_at ?? null) &&
        previous.shift_end === (shift?.effective_end ?? null)) {
      previous.slice_end = isoUs(end);
    } else slices.push({
      source_key: source.source_key, hour_start: hour, slice_start: isoUs(start), slice_end: isoUs(end),
      shift_id: shift?.id ?? null, shift_number: shift?.number ?? null, shift_date: shift?.local_date ?? null,
      shift_start: shift?.starts_at ?? null, shift_end: shift?.effective_end ?? null, count: 0,
    });
  }
  return slices;
}

interface AggregateRow {
  kind: string; source_key: string | null; slice_key: number | null; source_rows: string;
  distinct_rows: string | null; count: string; invalid_parts: string; invalid_reason: string;
  wrong_whiteboard: string; missing_slice: string; last_production_at: string | null;
}

/** Validate an aggregate response before exposing any zero or advancing progress. */
export function historyHoursFromAggregate(sources: HistorySource[], hour: string, until: string,
  slices: Map<string, HistorySlice[]>, rawRows: unknown[]): { hours: HistoryHour[]; issues: HistoryIssue[] } {
  const lo = timestampUs(hour), hi = timestampUs(until), issues: HistoryIssue[] = [];
  const rows = rawRows as AggregateRow[];
  const fail = (code: string) => ({ hours: [], issues: [{ source_key: null, hour_start: hour, code }] });
  if (rows.length > HISTORY_AGGREGATE_LIMIT + 1) return fail('HISTORY_AGGREGATE_LIMIT');
  const totals = rows.filter(row => row.kind === 'TOTAL');
  if (totals.length !== 1 || rows.some(row => !['TOTAL', 'SOURCE'].includes(row.kind))) return fail('HISTORY_AGGREGATE_INVALID');
  let observed: number;
  try {
    observed = integer(totals[0].source_rows);
    if (observed > HISTORY_EVENT_LIMIT) return fail('HISTORY_EVENT_LIMIT');
    if (integer(totals[0].distinct_rows) !== observed) return fail('HISTORY_DUPLICATE_EVENT_KEY');
  } catch { return fail('HISTORY_AGGREGATE_INVALID'); }
  const byKey = new Map(sources.map(source => [source.source_key, source]));
  const incoming = new Map<string, AggregateRow[]>();
  const seen = new Set<string>();
  let grouped = 0;
  for (const row of rows.filter(item => item.kind === 'SOURCE')) {
    try { grouped += integer(row.source_rows); } catch { return fail('HISTORY_AGGREGATE_INVALID'); }
    if (!Number.isSafeInteger(grouped)) return fail('HISTORY_COUNT_OVERFLOW');
    if (row.source_key === null || !byKey.has(row.source_key)) {
      issues.push({ source_key: null, hour_start: hour, code: 'HISTORY_UNKNOWN_SOURCE' });
      continue;
    }
    const key = row.source_key + ':' + String(row.slice_key);
    if (seen.has(key)) return fail('HISTORY_DUPLICATE_AGGREGATE');
    seen.add(key);
    const list = incoming.get(row.source_key) ?? [];
    list.push(row); incoming.set(row.source_key, list);
  }
  if (grouped !== observed) return fail('HISTORY_AGGREGATE_MISMATCH');
  const hours: HistoryHour[] = [];
  for (const source of sources) {
    const reject = (code: string): void => { issues.push({ source_key: source.source_key, hour_start: hour, code }); };
    if (source.review_reason && source.review_reason !== 'DUPLICATE_OPERATION') { reject(source.review_reason); continue; }
    const parts = (slices.get(source.source_key) ?? []).map(slice => ({ ...slice }));
    if (!parts.length) { reject('HISTORY_MISSING_SHIFT_SLICES'); continue; }
    let covered = lo;
    try {
      for (const part of parts) {
        if (part.source_key !== source.source_key || timestampUs(part.hour_start) !== lo ||
            timestampUs(part.slice_start) !== covered || timestampUs(part.slice_end) <= covered || timestampUs(part.slice_end) > hi) {
          throw new DsfRefusal('HISTORY_MISSING_SHIFT_SLICES');
        }
        covered = timestampUs(part.slice_end);
      }
      if (covered !== hi) throw new DsfRefusal('HISTORY_MISSING_SHIFT_SLICES');
    } catch { reject('HISTORY_MISSING_SHIFT_SLICES'); continue; }
    let count = 0, sourceRows = 0, last: string | null = null, bad: string | null = null;
    for (const row of incoming.get(source.source_key) ?? []) {
      try {
        if (!Number.isInteger(row.slice_key) || row.slice_key === null || row.slice_key < 0 || row.slice_key >= parts.length || integer(row.missing_slice)) {
          bad = 'HISTORY_MISSING_SHIFT_SLICES'; break;
        }
        if (integer(row.invalid_parts)) { bad = 'HISTORY_INVALID_PART_COUNT'; break; }
        if (integer(row.invalid_reason)) { bad = 'HISTORY_UNRESOLVED_REASON'; break; }
        if (integer(row.wrong_whiteboard)) { bad = 'HISTORY_WHITEBOARD_MISMATCH'; break; }
        const value = integer(row.count), rawCount = integer(row.source_rows);
        if (rawCount < 1 || (value > 0 && row.last_production_at === null)) { bad = 'HISTORY_AGGREGATE_INVALID'; break; }
        count += value; sourceRows += rawCount;
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(sourceRows)) { bad = 'HISTORY_COUNT_OVERFLOW'; break; }
        parts[row.slice_key].count = value;
        if (row.last_production_at !== null) {
          const timestamp = timestampUs(row.last_production_at);
          const slice = parts[row.slice_key];
          if (timestamp < lo || timestamp >= hi || timestamp < timestampUs(slice.slice_start) || timestamp >= timestampUs(slice.slice_end)) {
            bad = 'HISTORY_EVENT_OUTSIDE_WINDOW'; break;
          }
          if (last === null || timestampUs(last) < timestamp) last = row.last_production_at;
        }
      } catch { bad = 'HISTORY_AGGREGATE_INVALID'; break; }
    }
    if (bad) { reject(bad); continue; }
    hours.push({ source_key: source.source_key, hour_start: hour, covered_to: until,
      count, source_rows: sourceRows, last_production_at: last, slices: parts });
  }
  return { hours, issues };
}

/** Stage evidence only. Caller owns read-only source transaction and later local commit. */
export async function collectDsfHistory(client: HistoryQueryClient, at: string, plan: HistoryPlan): Promise<HistoryCapture> {
  const now = timestampUs(at);
  if (!HASH.test(plan.system_key) || plan.hours.length > 3 || plan.hours.length < 1 ||
      timestampUs(plan.backfill_hour) % HOUR_US !== 0n || timestampUs(plan.backfill_start) % HOUR_US !== 0n ||
      new Set(plan.hours).size !== plan.hours.length) throw new DsfRefusal('HISTORY_INVALID_PLAN');
  const hours = plan.hours.map(hour => {
    const start = timestampUs(hour);
    if (start % HOUR_US !== 0n || start > now) throw new DsfRefusal('HISTORY_INVALID_PLAN');
    return isoUs(start);
  });
  if (new Set(hours).size !== hours.length) throw new DsfRefusal('HISTORY_INVALID_PLAN');
  const sources = historySources((await client.query(HISTORY_CATALOG_SQL)).rows, plan.system_key);
  if (!sources.length) throw new DsfRefusal('HISTORY_EMPTY_CATALOG');
  const lineIds = [...new Set(sources.map(source => source.line_id))];
  const staged: HistoryHour[] = [], issues: HistoryIssue[] = [];
  for (const hour of hours) {
    const start = timestampUs(hour), end = start + HOUR_US < now ? start + HOUR_US : now;
    if (end === start) continue;
    const until = isoUs(end);
    const shiftRows = (await client.query(HISTORY_SHIFTS_SQL, [lineIds, hour, until])).rows as HistoryShiftRow[];
    if (shiftRows.length > 50000) throw new DsfRefusal('HISTORY_SHIFT_LIMIT');
    const slices = new Map(sources.map(source => [source.source_key, historyShiftSlices(source, hour, until, shiftRows)]));
    const scope = sources.flatMap(source => (slices.get(source.source_key) ?? []).map((slice, sliceKey) => ({
      source_key: source.source_key, mapping_id: source.mapping_id, whiteboard_id: source.whiteboard_id,
      op_id: source.op_id, slice_key: sliceKey, slice_start: slice.slice_start, slice_end: slice.slice_end,
    })));
    const result = historyHoursFromAggregate(sources, hour, until, slices,
      (await client.query(HISTORY_COUNTS_SQL, [hour, until, JSON.stringify(scope)])).rows);
    staged.push(...result.hours); issues.push(...result.issues);
  }
  const backfill = isoUs(timestampUs(plan.backfill_hour));
  // This is scan progress, not a coverage watermark. Scoped failures are retained
  // as unknown source-hours and revisited by rolling reconciliation; one retired
  // or malformed mapping must not pin every healthy source's historical scan.
  const advance = hours.includes(backfill) && timestampUs(backfill) + HOUR_US <= now &&
    !issues.some(issue => issue.hour_start === backfill && issue.source_key === null);
  return { system_key: plan.system_key, source_as_of: at, sources, hours: staged, issues,
    backfill_start: isoUs(timestampUs(plan.backfill_start)),
    next_backfill_hour: advance ? isoUs(timestampUs(backfill) + HOUR_US) : backfill };
}
