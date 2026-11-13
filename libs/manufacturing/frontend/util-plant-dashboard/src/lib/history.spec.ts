import type { DsfHistoryRecord, DsfHistoryReport } from '@meshforge/shared/domain';
import { defaultHistoryFilters, historyCountLabel, historyCsv, historyFilterError, plantDate } from './history';

const record = (overrides: Partial<DsfHistoryRecord> = {}): DsfHistoryRecord => ({
  source_key: 'source-key', source_name: 'CutGrind 3', department_id: 'department-id',
  department_name: 'CUTTER GRIND', machine_number: null, asset_number: '1-24-79',
  duplicate_operation: false, review_reason: null,
  period_start: '2026-11-12T00:00:00.123456-05:00', period_end: '2026-11-12T01:00:00-05:00',
  count: 0, completeness: 'COMPLETE', covered_seconds: 3600, expected_seconds: 3600,
  observed_at: '2026-11-12T06:00:01.654321Z', shift_id: 'shift-id', shift_number: 3,
  shift_date: '2026-11-11', ...overrides,
});
const report = (rows: DsfHistoryRecord[], overrides: Partial<DsfHistoryReport> = {}): DsfHistoryReport => ({
  format: 'DSFHISTORY1', available: true, served_at: '2026-11-12T06:01:00Z',
  timezone: 'America/Indiana/Indianapolis', from: '2026-11-12', to: '2026-11-12',
  group: 'hour', rows, truncated: false, row_limit: 5000,
  totals: { count: null, known_subtotal: 0, complete_records: 1, partial_records: 0,
    unknown_records: 1, review_records: 0, excluded_duplicate_sources: 0 },
  note: 'Recorded output across operations is not finished-goods production.', ...overrides,
});

describe('plant count history presentation', () => {
  it('uses Indianapolis dates independent of host timezone and daylight saving changes', () => {
    const previousTimezone = process.env['TZ'];
    try {
      process.env['TZ'] = 'Pacific/Auckland';
      expect(plantDate(new Date('2026-03-08T04:59:59Z'))).toBe('2026-03-07');
      expect(plantDate(Date.parse('2026-03-08T05:00:00Z'))).toBe('2026-03-08');
      expect(plantDate(new Date('2026-03-08T07:00:00Z'))).toBe('2026-03-08');
      expect(plantDate(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
      expect(plantDate(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01');
      expect(defaultHistoryFilters(Date.parse('2026-11-12T02:00:00Z'))).toEqual({
        from: '2026-11-11', to: '2026-11-11', group: 'day',
        source_key: '', department_id: '', include_inactive: false,
      });
      expect(plantDate(new Date('invalid'))).toBe('');
    } finally {
      if (previousTimezone === undefined) delete process.env['TZ'];
      else process.env['TZ'] = previousTimezone;
    }
  });

  it('validates inclusive calendar ranges without counting DST hours as dates', () => {
    const base = defaultHistoryFilters(Date.parse('2026-03-01T12:00:00Z'));
    expect(historyFilterError({ ...base, from: '2026-03-01', to: '2026-03-31' })).toBeNull();
    expect(historyFilterError({ ...base, from: '2026-10-15', to: '2026-11-14' })).toBeNull();
    expect(historyFilterError({ ...base, from: '2026-03-01', to: '2026-04-01' })).toContain('31 days');
    expect(historyFilterError({ ...base, from: '2026-03-09', to: '2026-03-08' })).toContain('on or after');
    for (const date of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-11-00', '2026-1-01', '0000-01-01']) {
      expect(historyFilterError({ ...base, from: date })).toContain('valid');
    }
    expect(historyFilterError({ ...base, from: '2028-02-29', to: '2028-02-29' })).toBeNull();
  });

  it('exports verified zero separately from unknown counts and retains evidence scope', () => {
    const rows = [record(), record({ source_key: 'missing-source', count: null, completeness: 'UNKNOWN', observed_at: null })];
    const csv = historyCsv(report(rows), { ...defaultHistoryFilters(), from: '2026-11-12', to: '2026-11-12',
      source_key: 'source-key', department_id: 'department-id', include_inactive: true });
    expect(csv).toContain('"From date (Indianapolis, inclusive)","2026-11-12"');
    expect(csv).toContain('"Report timezone","America/Indiana/Indianapolis"');
    expect(csv).toContain('"Source filter","source-key"');
    expect(csv).toContain('"Department filter","department-id"');
    expect(csv).toContain('"Include inactive sources","Yes"');
    expect(csv).toContain('"0","Complete","3600","3600"');
    expect(csv).toContain('"","Not collected","3600","3600"');
    expect(csv).toContain('"2026-11-12T05:00:00.123456Z"');
    expect(csv).toContain('"2026-11-12T06:00:01.654321Z"');
    expect(csv).toContain('"2026-11-11","3","shift-id"');
  });

  it('keeps result limits and review metadata visible and escapes spreadsheet formulas', () => {
    const row = record({ source_name: ' \t=HYPERLINK("unsafe")', machine_number: '@SUM(A1)',
      department_name: '+Dept', review_reason: '-Duplicate mapping', duplicate_operation: true,
      completeness: 'REVIEW', count: null });
    const csv = historyCsv(report([row], { truncated: true,
      totals: { count: 999, known_subtotal: 12, complete_records: 0, partial_records: 0,
        unknown_records: 0, review_records: 1, excluded_duplicate_sources: 1 } }));
    expect(csv).toContain('"Result truncated","Yes"');
    expect(csv).toContain('"Complete overall count",""');
    expect(csv).toContain('"Known subtotal","12"');
    expect(csv).toContain('"Sources excluded from totals for duplicate operations","1"');
    expect(csv).toContain('"\' \t=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"\'@SUM(A1)"');
    expect(csv).toContain('"\'+Dept"');
    expect(csv).toContain('"Yes","\'-Duplicate mapping"');
    expect(csv).toContain('"Needs review"');
    expect(historyCountLabel('PARTIAL')).toBe('Partial');
    expect(historyCountLabel('UNKNOWN')).toBe('Not collected');
    const emptyCsv = historyCsv(report([], { available: false }));
    expect(emptyCsv).toContain('"History available","No"');
    expect(emptyCsv).toContain('"Returned records","0"');
  });
});
