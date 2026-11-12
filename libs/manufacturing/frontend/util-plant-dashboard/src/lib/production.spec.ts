import type { MachineCount, ProductionSnapshot } from '@meshforge/shared/domain';
import { csvCell, filterMachines, formatPlantTime, freshCount, machineCsv, rowLabel, shiftReports } from './production';

const now = Date.parse('2026-11-11T16:00:00Z');
const machine = (overrides: Partial<MachineCount> = {}): MachineCount => ({
  machine_id: 'machine-1', machine_number: '549', department: '132', status: 'OK', count: 12,
  note: 'Current shift', shift_number: 1, shift_date: '2026-11-11',
  shift_start: '2026-11-11T11:00:00Z', shift_end: '2026-11-11T19:00:00Z',
  as_of: '2026-11-11T15:59:50Z', refreshed_at: '2026-11-11T15:59:51Z', ...overrides,
});
const snapshot = (rows: MachineCount[]): ProductionSnapshot => ({
  format: 'DSFCOUNT1', configured: true, interval_seconds: 60,
  last_success_at: '2026-11-11T15:59:51Z', served_at: '2026-11-11T16:00:00Z', rows,
});

describe('plant production evidence', () => {
  it('formats plant times in Indianapolis across daylight saving transitions', () => {
    expect(formatPlantTime('2026-03-08T06:59:00Z')).toBe('Mar 8, 1:59 AM');
    expect(formatPlantTime('2026-03-08T07:00:00Z')).toBe('Mar 8, 3:00 AM');
    expect(formatPlantTime('2026-11-12T02:37:00Z')).toBe('Nov 11, 9:37 PM');
    expect(formatPlantTime(null)).toBe('—');
  });

  it('preserves a verified zero and excludes missing, stale, invalid, or disabled counts', () => {
    const rows = [machine({ count: 0 }), machine({ count: null }), machine({ status: 'MAPPING_REVIEW' }),
      machine({ refreshed_at: '2026-11-11T15:50:00Z' }), machine({ count: -1 }), machine({ count: 1.5 }),
      machine({ as_of: '2026-11-11T16:10:00Z' }), machine({ shift_date: null })];
    expect(rows.map(row => freshCount(row, snapshot(rows), now))).toEqual([0, null, null, null, null, null, null, null]);
    expect(freshCount(rows[0], { ...snapshot(rows), configured: false }, now)).toBeNull();
  });

  it('expires cached counts without needing another successful HTTP request and expires a finished shift', () => {
    const row = machine();
    expect(freshCount(row, snapshot([row]), now)).toBe(12);
    expect(freshCount(row, snapshot([row]), now + 151000)).toBeNull();
    const ended = machine({ shift_end: '2026-11-11T16:00:00Z' });
    expect(freshCount(ended, snapshot([ended]), now)).toBeNull();
    expect(rowLabel(row, snapshot([row]), now + 151000)).toBe('Stale or invalid data');
  });

  it('keeps department, shift date, and distinct shift windows separate with partial coverage', () => {
    const rows = [machine(), machine({ machine_id: '2', status: 'UNAVAILABLE', count: null }),
      machine({ machine_id: '3', shift_start: '2026-11-11T12:00:00Z', count: 5 }),
      machine({ machine_id: '4', department: '45', count: 0 })];
    const reports = shiftReports(rows, snapshot(rows), now);
    expect(reports).toHaveLength(3);
    expect(reports[0]).toMatchObject({ machines: 2, reporting: 1, pieces: 12 });
    expect(reports[1].pieces).toBe(5);
    expect(reports[2].pieces).toBe(0);
    const missing = [machine({ count: null })];
    expect(shiftReports(missing, snapshot(missing), now)[0].pieces).toBeNull();
  });

  it('applies department, case-insensitive search, and review filters together', () => {
    const rows = [machine(), machine({ machine_id: '2', machine_number: 'G03', status: 'WAITING' }),
      machine({ machine_id: '3', machine_number: 'G03', department: '45' })];
    expect(filterMachines(rows, '132', 'g03', true, snapshot(rows), now).map(row => row.machine_id)).toEqual(['2']);
  });

  it('exports blanks for unavailable production, includes data status, and escapes spreadsheet formulas and quotes', () => {
    const rows = [machine({ count: 0 }), machine({ machine_number: '=1+1', status: 'UNAVAILABLE' })];
    const csv = machineCsv(rows, snapshot(rows), now);
    expect(csv).toContain('"0","Reporting"');
    expect(csv).toContain('"","Unavailable"');
    expect(csv).toContain('"\'=1+1"');
    expect(csvCell(' \t@SUM(A1)')).toBe('"\' \t@SUM(A1)"');
    expect(csvCell('Machine "A",\nB')).toBe('"Machine ""A"",\nB"');
  });
});
