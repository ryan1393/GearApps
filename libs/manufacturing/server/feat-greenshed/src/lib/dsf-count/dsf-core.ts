/* DSFCOUNT1. Pure shift/count logic. No database or workflow mutations. */
export const DSF_TIME_ZONE = 'America/Indiana/Indianapolis';
export const DSF_ROW_LIMIT = 10000;
export type DsfState = 'NOT_CONFIGURED' | 'WAITING' | 'OK' | 'STALE' |
  'MAPPING_REVIEW' | 'SHIFT_REVIEW' | 'DATA_REVIEW' | 'UNAVAILABLE' | 'INACTIVE';
export interface DsfShiftRow { id: string; number: number; starts_at: string; ends_at: string; local_date: string; }
export interface DsfShift extends DsfShiftRow { effective_end: string; }
export interface DsfCycle { id: string; at_us: string; at: string; parts: number; reason_code: string | null; reason_op: string | null; }
export interface DsfCache {
  shift: DsfShift; rows: Map<string, DsfCycle>; as_of: string;
  refreshed_at: string; full_reconciled_at: string; count: number;
}
export interface DsfCountRow {
  machine_id: string; machine_number: string; department: string; status: DsfState;
  count: number | null; note: string; shift_number: number | null;
  shift_date: string | null; shift_start: string | null; shift_end: string | null;
  as_of: string | null; refreshed_at: string | null; full_reconciled_at: string | null;
}
export class DsfRefusal extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'DsfRefusal'; }
}
// Preserve fractional precision when comparing cycle keys and incremental windows.
export function timestampUs(s: string): bigint {
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(s);
  if (!m) throw new DsfRefusal('INVALID_TIMESTAMP');
  const zone = m[4] === 'Z' ? 'Z' : m[4].length === 3 ? m[4] + ':00' : m[4];
  const ms = Date.parse(m[1] + 'T' + m[2] + zone);
  if (!Number.isFinite(ms)) throw new DsfRefusal('INVALID_TIMESTAMP');
  return BigInt(ms) * 1000n + BigInt((m[3] || '').padEnd(6, '0'));
}
export function isoUs(us: bigint): string {
  const seconds = us / 1000000n;
  return new Date(Number(seconds * 1000n)).toISOString().slice(0, 19) + '.' +
    String(us % 1000000n).padStart(6, '0') + 'Z';
}
export function chooseShift(rows: DsfShiftRow[], at: string): DsfShift {
  if (rows.length > 12) throw new DsfRefusal('SHIFT_ROW_LIMIT');
  const now = timestampUs(at);
  const sorted = [...rows].sort((a,b) => timestampUs(a.starts_at) < timestampUs(b.starts_at) ? -1 : 1);
  const candidates: DsfShift[] = [];
  for (const r of sorted) {
    const start = timestampUs(r.starts_at), rawEnd = timestampUs(r.ends_at);
    if (!Number.isInteger(r.number) || r.number < 1 || rawEnd <= start || rawEnd - start > 26n*3600n*1000000n)
      throw new DsfRefusal('INVALID_SHIFT');
    const nextStarts = sorted.filter(x => timestampUs(x.starts_at) > start)
      .map(x => timestampUs(x.starts_at)).sort((a,b)=>a<b?-1:1);
    const next = nextStarts[0];
    let end = rawEnd;
    // Only normalize the observed one-second end convention when a real next start proves it.
    if (next !== undefined && (next === rawEnd || next === rawEnd + 1000000n)) end = next;
    if (start <= now && now < end) candidates.push({...r, effective_end: isoUs(end)});
  }
  if (candidates.length !== 1) throw new DsfRefusal('MISSING_OR_OVERLAPPING_SHIFT');
  return candidates[0];
}
export function sameShift(a: DsfShift, b: DsfShift): boolean {
  return a.id === b.id && a.number === b.number && a.local_date === b.local_date &&
    timestampUs(a.starts_at) === timestampUs(b.starts_at) && timestampUs(a.effective_end) === timestampUs(b.effective_end);
}
export function replacementStart(previous: DsfCache | undefined, shift: DsfShift,
  now: string, lookbackSeconds: number, reconcileSeconds: number): {from: string; full: boolean} {
  const start=timestampUs(shift.starts_at), end=timestampUs(now);
  const full=!previous || !sameShift(previous.shift,shift) ||
    end < timestampUs(previous.as_of) ||
    end-timestampUs(previous.full_reconciled_at) >= BigInt(reconcileSeconds)*1000000n;
  if (full) return {from:shift.starts_at,full:true};
  const overlap=timestampUs(previous!.as_of)-BigInt(lookbackSeconds)*1000000n;
  return {from:isoUs(overlap>start?overlap:start),full:false};
}
export function reconcileRows(previous: DsfCache | undefined, shift: DsfShift,
  from: string, until: string, incoming: DsfCycle[], opId: string, full: boolean,
  refreshedAt: string): DsfCache {
  if(incoming.length>DSF_ROW_LIMIT) throw new DsfRefusal('CYCLE_ROW_LIMIT');
  const lo=timestampUs(from), hi=timestampUs(until), ss=timestampUs(shift.starts_at), se=timestampUs(shift.effective_end);
  if(lo<ss || hi>se || hi<lo || (full && lo!==ss)) throw new DsfRefusal('INVALID_READ_WINDOW');
  if(!full && (!previous || !sameShift(previous.shift,shift))) throw new DsfRefusal('MISSING_SHIFT_BASELINE');
  const merged=new Map<string,DsfCycle>();
  if(!full && previous) for(const [key,row] of previous.rows) {
    const t=BigInt(row.at_us);
    if(t>=ss && t<lo) merged.set(key,row); // replace the entire overlap, including deletions and corrections
  }
  const seen=new Set<string>();
  for(const r of incoming) {
    if(!/^\d+$/.test(String(r.id)) || !/^\d+$/.test(String(r.at_us))) throw new DsfRefusal('INVALID_CYCLE_KEY');
    const t=BigInt(r.at_us), key=String(r.id)+':'+String(r.at_us);
    if(t<lo || t>=hi || timestampUs(r.at)!==t) throw new DsfRefusal('CYCLE_OUTSIDE_WINDOW');
    if(seen.has(key)) throw new DsfRefusal('DUPLICATE_SOURCE_KEY');
    if(!Number.isSafeInteger(r.parts) || r.parts<0) throw new DsfRefusal('INVALID_PART_COUNT');
    if(r.reason_code===null || r.reason_op!==opId) throw new DsfRefusal('UNRESOLVED_REASON');
    seen.add(key);merged.set(key,{...r});
  }
  if(merged.size>DSF_ROW_LIMIT) throw new DsfRefusal('CYCLE_ROW_LIMIT');
  let total=0;
  for(const r of merged.values()) if(r.reason_code==='1') {
    total+=r.parts;
    if(!Number.isSafeInteger(total)) throw new DsfRefusal('COUNT_OVERFLOW');
  }
  return {shift:{...shift},rows:merged,as_of:until,refreshed_at:refreshedAt,
    full_reconciled_at:full?until:previous!.full_reconciled_at,count:total};
}
export function safeCountRow(machine: {machine_id:string;machine_number:string;department:string},
  cache: DsfCache | undefined, state: DsfState, note: string, now: string, staleSeconds:number): DsfCountRow {
  let status=state, usable=!!cache;
  if(cache && timestampUs(now)>=timestampUs(cache.shift.effective_end)) {usable=false; if(state==='OK'||state==='STALE')status='WAITING';}
  if(cache && state==='OK' && timestampUs(now)-timestampUs(cache.refreshed_at)>BigInt(staleSeconds)*1000000n)status='STALE';
  if(!['OK','STALE','UNAVAILABLE'].includes(state)) usable=false;
  return {...machine,status,count:usable?cache!.count:null,
    note:status==='STALE'?'Last successful DSF value; refresh delayed':!usable&&(state==='OK'||state==='STALE')?'Waiting for current source shift':note,
    shift_number:usable?cache!.shift.number:null,shift_date:usable?cache!.shift.local_date:null,
    shift_start:usable?cache!.shift.starts_at:null,shift_end:cache?cache.shift.effective_end:null,
    as_of:usable?cache!.as_of:null,refreshed_at:cache?.refreshed_at||null,
    full_reconciled_at:cache?.full_reconciled_at||null};
}
