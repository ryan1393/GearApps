import type { DsfHistoryCompleteness, DsfHistoryRecord, DsfHistoryReport } from '@meshforge/shared/domain';
import { historyFilterError } from './history';

const ZONE = 'America/Indiana/Indianapolis';
const HOUR = 3_600_000;
const civilFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', timeZoneName: 'short' });
const datedHourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short',
});
const detailFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

export interface HourlyProductionBucket {
  /** UTC identity: repeated local daylight-saving hours remain separate. */
  key: string;
  start: string;
  end: string;
  label: string;
  detailLabel: string;
  /** Verified returned subtotal; null means no accepted count evidence. */
  knownCount: number | null;
  /** Present only when the entire selected hour has accepted complete coverage. */
  totalCount: number | null;
  completeness: DsfHistoryCompleteness;
  completeSources: number;
  partialSources: number;
  unknownSources: number;
  reviewSources: number;
  excludedSources: number;
  expectedSources: number;
}

export interface HourlyProductionChart {
  available: boolean;
  supported: boolean;
  truncated: boolean;
  buckets: HourlyProductionBucket[];
  maxKnownCount: number;
  knownSubtotal: number | null;
  totalCount: number | null;
  sourceCount: number;
  invalidRows: number;
  note: string;
}

/** Resolve civil midnight with the plant's actual timezone offset, including DST. */
function midnight(date: string): number {
  const target = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(target)) return NaN;
  let candidate = target + 5 * HOUR;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = civilFormatter.formatToParts(candidate);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
    const civil = new Date(0);
    civil.setUTCFullYear(part('year'), part('month') - 1, part('day'));
    civil.setUTCHours(part('hour'), part('minute'), part('second'), 0);
    const correction = target - civil.getTime();
    candidate += correction;
    if (correction === 0) return candidate;
  }
  return NaN;
}

function nextDate(date: string): string {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().split('T')[0];
}

function timestamp(value: string): number {
  return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

function validCoverage(row: DsfHistoryRecord): boolean {
  return Number.isFinite(row.covered_seconds) && row.covered_seconds >= 0 &&
    Number.isFinite(row.expected_seconds) && row.expected_seconds === HOUR / 1000 &&
    row.covered_seconds <= row.expected_seconds;
}

/**
 * Chart retained RUN counts only. The server already applies department/date
 * filters. An optional source key further narrows that response and never falls
 * back to the aggregate when the requested source is absent.
 */
export function buildHourlyProductionChart(report: DsfHistoryReport | null, sourceKey?: string): HourlyProductionChart {
  const result: HourlyProductionChart = {
    available: report?.available ?? false, supported: report?.group === 'hour', truncated: report?.truncated ?? false,
    buckets: [], maxKnownCount: 0, knownSubtotal: null, totalCount: null, sourceCount: 0, invalidRows: 0,
    note: 'No saved hourly production is available yet.',
  };
  if (!report?.available) return result;
  if (report.group !== 'hour') return { ...result, note: 'Choose hourly grouping to chart recorded production.' };
  const error = historyFilterError({ from: report.from, to: report.to, group: 'hour', source_key: '', department_id: '', include_inactive: false });
  if (error) return { ...result, note: error };
  const start = midnight(report.from), end = midnight(nextDate(report.to));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 745 * HOUR) {
    return { ...result, note: 'The selected calendar hours could not be resolved.' };
  }
  const selected = report.rows.filter(row => sourceKey === undefined || row.source_key === sourceKey);
  const sources = new Set(selected.map(row => row.source_key).filter(key => typeof key === 'string' && key.length > 0));
  result.sourceCount = sources.size;
  // A requested but missing source still has unknown hours, not a plant total.
  if (sourceKey !== undefined && sources.size === 0) sources.add(sourceKey);
  const byHour = new Map<number, Map<string, DsfHistoryRecord[]>>();
  for (const row of selected) {
    const at = timestamp(row.period_start), until = timestamp(row.period_end);
    if (!sources.has(row.source_key) || !Number.isFinite(at) || until - at !== HOUR ||
        at < start || until > end || (at - start) % HOUR !== 0) {
      result.invalidRows++;
      continue;
    }
    const entries = byHour.get(at) ?? new Map<string, DsfHistoryRecord[]>();
    const sourceRows = entries.get(row.source_key) ?? [];
    sourceRows.push(row);
    entries.set(row.source_key, sourceRows);
    byHour.set(at, entries);
  }
  for (let at = start; at < end; at += HOUR) {
    const bucket: HourlyProductionBucket = {
      key: new Date(at).toISOString(), start: new Date(at).toISOString(), end: new Date(at + HOUR).toISOString(),
      label: (report.from === report.to ? hourFormatter : datedHourFormatter).format(at),
      detailLabel: detailFormatter.format(at) + ' – ' + detailFormatter.format(at + HOUR),
      knownCount: null, totalCount: null, completeness: 'UNKNOWN', completeSources: 0, partialSources: 0,
      unknownSources: 0, reviewSources: 0, excludedSources: 0, expectedSources: sources.size,
    };
    let sum = 0, accepted = 0, overflow = false;
    for (const source of sources) {
      const entries = byHour.get(at)?.get(source);
      if (!entries?.length) { bucket.unknownSources++; continue; }
      if (entries.length !== 1) { bucket.reviewSources++; continue; }
      const row = entries[0];
      if (row.duplicate_operation) { bucket.excludedSources++; continue; }
      if (row.review_reason !== null || row.completeness === 'REVIEW' || !validCoverage(row)) { bucket.reviewSources++; continue; }
      if (row.completeness === 'UNKNOWN' && row.count === null) { bucket.unknownSources++; continue; }
      if (!Number.isSafeInteger(row.count) || (row.count ?? -1) < 0 || row.covered_seconds === 0 ||
          !['COMPLETE', 'PARTIAL'].includes(row.completeness) ||
          row.completeness === 'COMPLETE' && row.covered_seconds !== row.expected_seconds) {
        bucket.reviewSources++; continue;
      }
      sum += row.count ?? 0;
      accepted++;
      if (!Number.isSafeInteger(sum)) overflow = true;
      if (row.completeness === 'COMPLETE') bucket.completeSources++;
      else bucket.partialSources++;
    }
    if (accepted && !overflow) bucket.knownCount = sum;
    if (bucket.reviewSources || bucket.excludedSources || overflow || result.invalidRows) bucket.completeness = 'REVIEW';
    else if (sources.size && bucket.completeSources === sources.size && !result.truncated) bucket.completeness = 'COMPLETE';
    else if (accepted) bucket.completeness = 'PARTIAL';
    if (bucket.completeness === 'COMPLETE') bucket.totalCount = bucket.knownCount;
    result.buckets.push(bucket);
  }
  const known = result.buckets.filter(bucket => bucket.knownCount !== null);
  let subtotalOverflow = false;
  if (known.length) {
    const subtotal = known.reduce((sum, bucket) => sum + (bucket.knownCount ?? 0), 0);
    if (Number.isSafeInteger(subtotal)) result.knownSubtotal = subtotal;
    else subtotalOverflow = true;
    result.maxKnownCount = Math.max(...known.map(bucket => bucket.knownCount ?? 0));
  }
  if (result.buckets.length && result.buckets.every(bucket => bucket.completeness === 'COMPLETE')) result.totalCount = result.knownSubtotal;
  result.note = subtotalOverflow ? 'The selected subtotal exceeds supported precision; narrow the source or date filters.'
    : result.invalidRows ? 'Some hourly records require review; their counts are excluded.'
    : result.truncated ? 'Only returned records are charted. Narrow the date or source filters for complete coverage.'
      : sourceKey !== undefined && result.sourceCount === 0 ? 'No saved records were returned for this source. Missing hours are unknown.'
        : 'Recorded RUN pieces by Indianapolis hour. Missing or future periods stay unknown; partial bars show the known count only.';
  return result;
}
