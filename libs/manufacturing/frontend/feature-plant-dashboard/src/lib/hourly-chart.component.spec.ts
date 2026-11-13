import { TestBed } from '@angular/core/testing';
import type { DsfHistoryRecord, DsfHistoryReport } from '@meshforge/shared/domain';
import { HourlyChartComponent } from './hourly-chart.component';

const sourceKey = 'a'.repeat(64);
const record = (hour: number, count: number | null, changes: Partial<DsfHistoryRecord> = {}): DsfHistoryRecord => ({
  source_key: sourceKey, source_name: 'CutGrind 6', department_id: 'cutter', department_name: 'CUTTER GRIND',
  machine_number: null, asset_number: null, duplicate_operation: false, review_reason: null,
  period_start: `2026-11-11T${String(hour).padStart(2, '0')}:00:00Z`, period_end: `2026-11-11T${String(hour + 1).padStart(2, '0')}:00:00Z`,
  count, completeness: 'COMPLETE', covered_seconds: 3600, expected_seconds: 3600,
  observed_at: '2026-11-12T03:00:00Z', shift_id: null, shift_number: null, shift_date: null, ...changes,
});
const report: DsfHistoryReport = {
  format: 'DSFHISTORY1', available: true, served_at: '2026-11-12T03:00:00Z', timezone: 'America/Indiana/Indianapolis',
  from: '2026-11-11', to: '2026-11-11', group: 'hour', truncated: false, row_limit: 5000,
  rows: [record(5, 0), record(6, 4, { completeness: 'PARTIAL', covered_seconds: 1800 }), record(8, 99, { completeness: 'REVIEW', review_reason: 'identity' })],
  totals: { count: null, known_subtotal: 4, complete_records: 1, partial_records: 1, unknown_records: 0, review_records: 1, excluded_duplicate_sources: 0 },
  note: 'Preview records',
};

describe('Accessible hourly production chart', () => {
  afterEach(() => TestBed.resetTestingModule());
  function create() {
    TestBed.configureTestingModule({ imports: [HourlyChartComponent] });
    const fixture = TestBed.createComponent(HourlyChartComponent);
    fixture.componentRef.setInput('report', report); fixture.componentRef.setInput('sourceKey', sourceKey);
    fixture.componentRef.setInput('scaleMax', 20); fixture.detectChanges();
    return fixture;
  }

  it('renders verified zero separately from missing and review evidence and exposes exact partial counts', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-hour-index="0"] circle')).not.toBeNull();
    expect(host.querySelector('[data-hour-index="0"]')?.getAttribute('aria-label')).toContain('0 RUN pieces · complete hour');
    expect(host.querySelector('[data-hour-index="1"]')?.getAttribute('aria-label')).toContain('4 known RUN pieces · partial coverage');
    expect(host.querySelector('[data-hour-index="2"]')?.getAttribute('aria-label')).toContain('Unknown');
    expect(host.querySelector('[data-hour-index="3"]')?.getAttribute('aria-label')).toContain('Needs review');
    expect(fixture.componentInstance.model().knownSubtotal).toBe(4);
    expect(fixture.componentInstance.maximum()).toBe(20);
  });

  it('lets a single tab stop inspect every hour with arrow keys, showing exact values without hover', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector('[data-hour-index="0"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-hour-index][tabindex="0"]')).toHaveLength(1);
    expect(host.querySelector('[data-hour-index="1"]')?.getAttribute('tabindex')).toBe('0');
    expect(host.querySelector('.hourly-readout')?.textContent).toContain('4 known RUN pieces');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(24);
  });

  it('visually distinguishes a partial zero from a complete zero', () => {
    const fixture = create();
    fixture.componentRef.setInput('report', { ...report, rows: [record(5, 0), record(6, 0, { completeness: 'PARTIAL', covered_seconds: 1800 })] });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-hour-index="0"] circle')?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(host.querySelector('[data-hour-index="1"] circle')?.getAttribute('stroke-dasharray')).toBe('2 2');
    expect(host.querySelector('[data-hour-index="1"]')?.getAttribute('aria-label')).toContain('0 known RUN pieces · partial coverage');
  });

  it('preserves both repeated DST hours and does not substitute another source when one is missing', () => {
    const fixture = create();
    fixture.componentRef.setInput('report', { ...report, from: '2026-11-01', to: '2026-11-01', rows: [] }); fixture.detectChanges();
    const buckets = fixture.componentInstance.model().buckets;
    expect(buckets).toHaveLength(25);
    expect(buckets.filter(bucket => bucket.label === '1 AM EDT')).toHaveLength(1);
    expect(buckets.filter(bucket => bucket.label === '1 AM EST')).toHaveLength(1);
    expect(buckets.every(bucket => bucket.knownCount === null)).toBe(true);
    expect(fixture.componentInstance.model().knownSubtotal).toBeNull();
    fixture.componentInstance.width.set(280);
    expect(fixture.componentInstance.barWidth()).toBeGreaterThanOrEqual(1);
  });
});
