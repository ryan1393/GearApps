import type { DsfHistoryCompleteness, DsfHistoryGroup, DsfHistoryReport } from '@meshforge/shared/domain';
import { csvCell } from './production';

export interface PlantHistoryFilters {
  from: string;
  to: string;
  group: DsfHistoryGroup;
  source_key: string;
  department_id: string;
  include_inactive: boolean;
}

const PLANT_TIMEZONE = 'America/Indiana/Indianapolis';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar date at the plant, independent of the browser or server timezone. */
export function plantDate(value: Date | number = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PLANT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

export function defaultHistoryFilters(now: Date | number = Date.now()): PlantHistoryFilters {
  const date = plantDate(now);
  return { from: date, to: date, group: 'day', source_key: '', department_id: '', include_inactive: false };
}

function calendarDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1) return null;
  // setUTCFullYear avoids Date.UTC's special interpretation of years 0 through 99.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() / DAY_MS : null;
}

/** Dates are inclusive plant-calendar dates; a DST change does not add a day. */
export function historyFilterError(filters: PlantHistoryFilters): string | null {
  const from = calendarDay(filters.from), to = calendarDay(filters.to);
  if (from === null || to === null) return 'Choose valid start and end dates.';
  if (to < from) return 'The end date must be on or after the start date.';
  if (to - from + 1 > 31) return 'Choose a range of 31 days or fewer.';
  if (!['hour', 'shift', 'day'].includes(filters.group)) return 'Choose hours, shifts, or days.';
  return null;
}

export function historyCountLabel(status: DsfHistoryCompleteness): string {
  const labels: Record<DsfHistoryCompleteness, string> = {
    COMPLETE: 'Complete', PARTIAL: 'Partial', UNKNOWN: 'Not collected', REVIEW: 'Needs review',
  };
  return labels[status] ?? 'Unknown';
}

/** Normalize an explicit offset to UTC without discarding source microseconds. */
function csvUtc(value: string | null): string | null {
  if (value === null) return null;
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString().slice(0, 19) + (match[1] ?? '.000') + 'Z';
}

/** Export the returned evidence and its scope; missing counts remain blank. */
export function historyCsv(report: DsfHistoryReport, filters?: PlantHistoryFilters): string {
  const rows: Array<Array<string | number | null>> = [
    ['Report', 'DSF recorded RUN production'],
    ['From date (Indianapolis, inclusive)', report.from],
    ['To date (Indianapolis, inclusive)', report.to],
    ['Grouping', report.group],
    ['Date scope', report.group === 'shift' ? 'DSF shift start dates, including continuation after midnight' : 'Indianapolis calendar dates'],
    ['Report timezone', report.timezone],
    ['Source filter', filters?.source_key || 'All sources'],
    ['Department filter', filters?.department_id || 'All departments'],
    ['Include inactive sources', filters ? (filters.include_inactive ? 'Yes' : 'No') : 'See returned source scope'],
    ['History available', report.available ? 'Yes' : 'No'],
    ['Result truncated', report.truncated ? 'Yes' : 'No'],
    ['Result row limit', report.row_limit],
    ['Returned records', report.rows.length],
    ['Complete overall count', report.truncated ? null : report.totals.count],
    ['Known subtotal', report.totals.known_subtotal],
    ['Sources excluded from totals for duplicate operations', report.totals.excluded_duplicate_sources],
    ['Report note', report.note],
    ['Exported UTC', csvUtc(report.served_at)],
    [],
    ['DSF source', 'Source identity', 'Department', 'Linked machine', 'Plant asset',
      'Period start UTC', 'Period end UTC', 'Shift date', 'Shift', 'Shift identity',
      'Recorded RUN pieces', 'Coverage', 'Covered seconds', 'Expected seconds',
      'Observed UTC', 'Duplicate operation', 'Review reason'],
    ...report.rows.map(row => [row.source_name, row.source_key, row.department_name,
      row.machine_number, row.asset_number, csvUtc(row.period_start), csvUtc(row.period_end),
      row.shift_date, row.shift_number, row.shift_id, row.completeness === 'UNKNOWN' ? null : row.count, historyCountLabel(row.completeness),
      row.covered_seconds, row.expected_seconds, csvUtc(row.observed_at),
      row.duplicate_operation ? 'Yes' : 'No', row.review_reason]),
  ];
  return rows.map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
