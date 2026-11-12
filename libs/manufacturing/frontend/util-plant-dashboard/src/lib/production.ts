import type { MachineCount, ProductionSnapshot, ShiftReport } from '@meshforge/shared/domain';

export function formatPlantTime(value: string | null, seconds = false): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Indianapolis', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  }).format(new Date(value));
}

/** A clock time such as 3:04:05 PM, in the plant's time zone. */
export function formatPlantClock(epochMs: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Indianapolis', hour: 'numeric', minute: '2-digit', second: '2-digit',
  }).format(new Date(epochMs));
}

/** How long ago a reading arrived, for a glance: "12 s ago", "3 min ago", "2 h ago". */
export function formatAge(sinceMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

// A count of zero is valid. Missing or stale evidence never becomes zero output.
export function freshCount(row: MachineCount, snapshot: ProductionSnapshot, now: number): number | null {
  const refreshed = Date.parse(row.refreshed_at ?? '');
  const asOf = Date.parse(row.as_of ?? '');
  const start = Date.parse(row.shift_start ?? '');
  const end = Date.parse(row.shift_end ?? '');
  const interval = snapshot.interval_seconds;
  const maxAge = (interval * 2 + 30) * 1000;
  return snapshot.configured && row.status === 'OK' &&
    Number.isFinite(interval) && interval >= 30 && interval <= 3600 &&
    Number.isSafeInteger(row.count) && row.count !== null && row.count >= 0 &&
    Number.isInteger(row.shift_number) && (row.shift_number ?? 0) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.shift_date ?? '') &&
    Number.isFinite(refreshed) && Number.isFinite(asOf) &&
    refreshed <= now + 10000 && now - refreshed <= maxAge &&
    asOf <= now + 10000 && now - asOf <= maxAge &&
    start <= asOf && asOf <= end && now < end
    ? row.count : null;
}

export function rowLabel(row: MachineCount, snapshot: ProductionSnapshot, now: number): string {
  if (freshCount(row, snapshot, now) !== null) return 'Reporting';
  const labels: Record<string, string> = {
    NOT_CONFIGURED: 'Not connected', WAITING: 'Waiting for data', STALE: 'Stale data',
    MAPPING_REVIEW: 'Check mapping', SHIFT_REVIEW: 'Check shift', DATA_REVIEW: 'Check source data',
    UNAVAILABLE: 'Unavailable', INACTIVE: 'Inactive in MeshForge',
  };
  return row.status === 'OK' ? 'Stale or invalid data' : labels[row.status] ?? 'Unavailable';
}

export function filterMachines(rows: MachineCount[], department: string, search: string, attention: boolean,
  snapshot: ProductionSnapshot, now: number): MachineCount[] {
  const query = search.trim().toLowerCase();
  return rows.filter(row => (!department || row.department === department) &&
    `${row.machine_number} ${row.department}`.toLowerCase().includes(query) &&
    (!attention || freshCount(row, snapshot, now) === null))
    .sort((a, b) => a.department.localeCompare(b.department, undefined, { numeric: true }) ||
      a.machine_number.localeCompare(b.machine_number, undefined, { numeric: true }));
}

export function shiftReports(rows: MachineCount[], snapshot: ProductionSnapshot, now: number): ShiftReport[] {
  const groups = new Map<string, ShiftReport>();
  for (const row of rows) {
    // Separate shift boundaries too: lines can use different schedules with the same shift number.
    const key = [row.department, row.shift_date, row.shift_number, row.shift_start, row.shift_end]
      .map(value => value === null ? 'null' : `${typeof value}:${encodeURIComponent(String(value))}`)
      .join('|');
    const report = groups.get(key) ?? { key, department: row.department, date: row.shift_date,
      shift: row.shift_number, start: row.shift_start, end: row.shift_end,
      machines: 0, reporting: 0, pieces: null };
    report.machines++;
    const count = freshCount(row, snapshot, now);
    if (count !== null) { report.reporting++; report.pieces = (report.pieces ?? 0) + count; }
    groups.set(key, report);
  }
  return [...groups.values()];
}

export function csvCell(value: string | number | null): string {
  let text = String(value ?? '');
  // Prevent spreadsheet formula interpretation, including after leading whitespace.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function machineCsv(rows: MachineCount[], snapshot: ProductionSnapshot, now: number): string {
  const header = ['Machine', 'Department', 'Shift date', 'Shift', 'Shift start UTC', 'Shift end UTC',
    'RUN pieces', 'Data status', 'Count through UTC', 'Exported UTC'];
  return [header, ...rows.map(row => [row.machine_number, row.department, row.shift_date, row.shift_number,
    row.shift_start, row.shift_end, freshCount(row, snapshot, now), rowLabel(row, snapshot, now),
    row.as_of, new Date(now).toISOString()])].map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
