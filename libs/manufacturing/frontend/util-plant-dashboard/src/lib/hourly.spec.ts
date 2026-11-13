import type { DsfHistoryRecord, DsfHistoryReport } from '@meshforge/shared/domain';
import { buildHourlyProductionChart } from './hourly';

const row = (overrides: Partial<DsfHistoryRecord> = {}): DsfHistoryRecord => ({
  source_key: 'grinder-3', source_name: 'CutGrind 3', department_id: 'department-45', department_name: 'CUTTER GRIND',
  machine_number: '1-24-79', asset_number: '1-24-79', duplicate_operation: false, review_reason: null,
  period_start: '2026-11-11T20:00:00Z', period_end: '2026-11-11T21:00:00Z', count: 12,
  completeness: 'COMPLETE', covered_seconds: 3600, expected_seconds: 3600,
  observed_at: '2026-11-12T02:56:23Z', shift_id: null, shift_number: null, shift_date: null, ...overrides,
});
const report = (rows: DsfHistoryRecord[], overrides: Partial<DsfHistoryReport> = {}): DsfHistoryReport => ({
  format: 'DSFHISTORY1', available: true, served_at: '2026-11-12T02:56:23Z', timezone: 'America/Indiana/Indianapolis',
  from: '2026-11-11', to: '2026-11-11', group: 'hour', rows, truncated: false, row_limit: 5000,
  totals: { count: null, known_subtotal: 999, complete_records: 0, partial_records: 0, unknown_records: 0, review_records: 0, excluded_duplicate_sources: 0 },
  note: '', ...overrides,
});

describe('hour-by-hour retained production chart', () => {
  it('groups different source rows into UTC hours without summing successive hours into one bar', () => {
    const chart = buildHourlyProductionChart(report([
      row(), row({ source_key: 'grinder-4', count: 3 }),
      row({ period_start: '2026-11-11T21:00:00Z', period_end: '2026-11-11T22:00:00Z', count: 4 }),
    ]));
    expect(chart.buckets).toHaveLength(24);
    expect(chart.buckets.find(bucket => bucket.start === '2026-11-11T20:00:00.000Z')).toMatchObject({
      knownCount: 15, totalCount: 15, completeness: 'COMPLETE', completeSources: 2, expectedSources: 2,
    });
    expect(chart.buckets.find(bucket => bucket.start === '2026-11-11T21:00:00.000Z')).toMatchObject({
      knownCount: 4, totalCount: null, completeness: 'PARTIAL', completeSources: 1, unknownSources: 1,
    });
    expect(chart.knownSubtotal).toBe(19);
    expect(chart.totalCount).toBeNull();
    expect(chart.maxKnownCount).toBe(15);
  });

  it('keeps verified zero, partial zero, unknown and future periods distinct', () => {
    const chart = buildHourlyProductionChart(report([
      row({ count: 0 }),
      row({ period_start: '2026-11-11T21:00:00Z', period_end: '2026-11-11T22:00:00Z', count: 0, completeness: 'PARTIAL', covered_seconds: 120 }),
      row({ period_start: '2026-11-11T22:00:00Z', period_end: '2026-11-11T23:00:00Z', count: null, completeness: 'UNKNOWN', covered_seconds: 0 }),
    ]));
    const at = (hour: string) => chart.buckets.find(bucket => bucket.start === `2026-11-11T${hour}:00:00.000Z`);
    expect(at('20')).toMatchObject({ knownCount: 0, totalCount: 0, completeness: 'COMPLETE' });
    expect(at('21')).toMatchObject({ knownCount: 0, totalCount: null, completeness: 'PARTIAL' });
    expect(at('22')).toMatchObject({ knownCount: null, totalCount: null, completeness: 'UNKNOWN' });
    expect(at('23')).toMatchObject({ knownCount: null, totalCount: null, completeness: 'UNKNOWN' });
    expect(chart.knownSubtotal).toBe(0);
  });

  it('narrows to a requested source and never uses another machine as a missing-source fallback', () => {
    const input = report([row(), row({ source_key: 'grinder-4', count: 71 })]);
    expect(buildHourlyProductionChart(input, 'grinder-4').knownSubtotal).toBe(71);
    expect(buildHourlyProductionChart(input, 'grinder-4').sourceCount).toBe(1);
    const missing = buildHourlyProductionChart(input, 'missing');
    expect(missing.sourceCount).toBe(0);
    expect(missing.buckets).toHaveLength(24);
    expect(missing.buckets.every(bucket => bucket.knownCount === null && bucket.completeness === 'UNKNOWN')).toBe(true);
    expect(missing.knownSubtotal).toBeNull();
  });

  it('excludes ambiguous and duplicate-operation counts but retains healthy known contributions', () => {
    const chart = buildHourlyProductionChart(report([
      row(), row({ source_key: 'duplicate', count: 500, duplicate_operation: true }),
      row({ source_key: 'review', count: 600, completeness: 'REVIEW', review_reason: 'Identity changed' }),
    ]));
    expect(chart.buckets.find(bucket => bucket.knownCount !== null)).toMatchObject({
      knownCount: 12, totalCount: null, completeness: 'REVIEW', completeSources: 1, reviewSources: 1, excludedSources: 1,
    });
    expect(chart.knownSubtotal).toBe(12);
  });

  it('does not double-count repeated rows for the same source/hour', () => {
    const chart = buildHourlyProductionChart(report([row(), row(), row({ source_key: 'healthy', count: 5 })]));
    expect(chart.buckets.find(bucket => bucket.knownCount !== null)).toMatchObject({ knownCount: 5, completeness: 'REVIEW', reviewSources: 1 });
    expect(chart.knownSubtotal).toBe(5);
  });

  it('preserves the two fall-back hours and the spring-forward missing clock hour', () => {
    const fall = buildHourlyProductionChart(report([
      row({ period_start: '2026-11-01T05:00:00Z', period_end: '2026-11-01T06:00:00Z', count: 2 }),
      row({ period_start: '2026-11-01T06:00:00Z', period_end: '2026-11-01T07:00:00Z', count: 3 }),
    ], { from: '2026-11-01', to: '2026-11-01' }));
    expect(fall.buckets).toHaveLength(25);
    expect(fall.buckets.filter(bucket => bucket.label.startsWith('1 AM')).map(bucket => [bucket.label, bucket.knownCount])).toEqual([
      ['1 AM EDT', 2], ['1 AM EST', 3],
    ]);
    expect(new Set(fall.buckets.map(bucket => bucket.key)).size).toBe(25);
    const spring = buildHourlyProductionChart(report([], { from: '2026-03-08', to: '2026-03-08' }), 'grinder-3');
    expect(spring.buckets).toHaveLength(23);
    expect(spring.buckets.some(bucket => bucket.label.startsWith('2 AM'))).toBe(false);
    expect(spring.buckets.every(bucket => bucket.knownCount === null)).toBe(true);
  });

  it('includes date context across midnight and is independent of host/browser timezone', () => {
    const previous = process.env['TZ'];
    process.env['TZ'] = 'Pacific/Auckland';
    try {
      const chart = buildHourlyProductionChart(report([], { from: '2026-11-11', to: '2026-11-12' }), 'grinder-3');
      expect(chart.buckets).toHaveLength(48);
      expect(chart.buckets[0].start).toBe('2026-11-11T05:00:00.000Z');
      expect(chart.buckets[0].label).toContain('Nov 11');
      expect(chart.buckets[24].label).toContain('Nov 12');
      expect(chart.buckets[0].detailLabel).toContain('EST');
    } finally {
      if (previous === undefined) delete process.env['TZ']; else process.env['TZ'] = previous;
    }
  });

  it('makes truncation explicit and never certifies a complete limited result', () => {
    const chart = buildHourlyProductionChart(report([row()], { truncated: true }));
    expect(chart.truncated).toBe(true);
    expect(chart.totalCount).toBeNull();
    expect(chart.buckets.find(bucket => bucket.knownCount !== null)).toMatchObject({ knownCount: 12, totalCount: null, completeness: 'PARTIAL' });
    expect(chart.note).toContain('Only returned records');
  });

  it('certifies a full-day count only when every hour has complete selected-source coverage', () => {
    const periods = buildHourlyProductionChart(report([]), 'grinder-3').buckets;
    const full = periods.map((period, index) => row({ period_start: period.start, period_end: period.end, count: index }));
    const chart = buildHourlyProductionChart(report(full), 'grinder-3');
    expect(chart.buckets.every(bucket => bucket.completeness === 'COMPLETE')).toBe(true);
    expect(chart.knownSubtotal).toBe(276);
    expect(chart.totalCount).toBe(276);
    expect(buildHourlyProductionChart(report(full.slice(1)), 'grinder-3').totalCount).toBeNull();
    expect(buildHourlyProductionChart(report(full, { truncated: true }), 'grinder-3').totalCount).toBeNull();
  });

  it('leaves unsafe aggregate arithmetic unknown rather than rounding pieces', () => {
    const bucketOverflow = buildHourlyProductionChart(report([
      row({ count: Number.MAX_SAFE_INTEGER }), row({ source_key: 'second', count: 1 }),
    ]));
    expect(bucketOverflow.buckets.find(bucket => bucket.start === '2026-11-11T20:00:00.000Z')).toMatchObject({
      knownCount: null, totalCount: null, completeness: 'REVIEW',
    });
    const subtotalOverflow = buildHourlyProductionChart(report([
      row({ count: Number.MAX_SAFE_INTEGER }),
      row({ period_start: '2026-11-11T21:00:00Z', period_end: '2026-11-11T22:00:00Z', count: 1 }),
    ]));
    expect(subtotalOverflow.knownSubtotal).toBeNull();
    expect(subtotalOverflow.note).toContain('precision');
  });

  it('rejects unsafe counts and inconsistent coverage instead of plotting accepted totals', () => {
    for (const changes of [{ count: -1 }, { count: Number.MAX_SAFE_INTEGER + 1 }, { count: 1.5 },
      { covered_seconds: 1 }, { expected_seconds: 7200 }, { completeness: 'UNKNOWN' as const, count: 8 }]) {
      const chart = buildHourlyProductionChart(report([row(changes)]));
      expect(chart.buckets.find(bucket => bucket.start === '2026-11-11T20:00:00.000Z')).toMatchObject({
        knownCount: null, totalCount: null, completeness: 'REVIEW',
      });
    }
  });

  it('flags malformed hourly bounds and avoids silently dropping their evidence', () => {
    const chart = buildHourlyProductionChart(report([row({ period_end: 'invalid' })]));
    expect(chart.invalidRows).toBe(1);
    expect(chart.buckets.every(bucket => bucket.knownCount === null && bucket.completeness === 'REVIEW')).toBe(true);
    expect(chart.note).toContain('require review');
  });

  it('refuses unsupported groupings, unavailable archives and invalid ranges without invented series', () => {
    expect(buildHourlyProductionChart(null)).toMatchObject({ available: false, buckets: [], knownSubtotal: null });
    expect(buildHourlyProductionChart(report([], { available: false }))).toMatchObject({ available: false, buckets: [] });
    expect(buildHourlyProductionChart(report([row()], { group: 'day' }))).toMatchObject({ supported: false, buckets: [] });
    expect(buildHourlyProductionChart(report([], { from: '2026-02-31' })).buckets).toEqual([]);
    expect(buildHourlyProductionChart(report([], { from: '2026-01-01', to: '2026-12-31' })).buckets).toEqual([]);
  });
});
