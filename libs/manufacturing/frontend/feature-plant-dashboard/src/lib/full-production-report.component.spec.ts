import { TestBed } from '@angular/core/testing';
import type { DsfHistoryRecord, DsfHistoryReport, DsfHistorySource } from '@meshforge/shared/domain';
import { FullProductionReportComponent } from './full-production-report.component';

const source: DsfHistorySource = {
  source_key: 'a'.repeat(64), mapping_id: 'mapping', whiteboard_id: 'board', op_id: 'operation', line_id: 'line',
  department_id: 'cutter', source_name: 'CutGrind 6', line_name: 'CutGrind 6', department_name: 'CUTTER GRIND',
  asset_number: '1-24-77', active: true, current: true, duplicate_operation: false, review_reason: null,
  machine_id: null, machine_number: null, last_seen_at: '2026-11-11T23:00:00Z',
};
const row = (hour: number, count: number, changes: Partial<DsfHistoryRecord> = {}): DsfHistoryRecord => ({
  source_key: source.source_key, source_name: source.source_name, department_id: source.department_id, department_name: source.department_name,
  machine_number: null, asset_number: source.asset_number, duplicate_operation: false, review_reason: null,
  period_start: `2026-11-11T${hour}:00:00Z`, period_end: `2026-11-11T${hour + 1}:00:00Z`, count, completeness: 'COMPLETE',
  covered_seconds: 3600, expected_seconds: 3600, observed_at: '2026-11-11T23:00:00Z', shift_id: null, shift_number: null, shift_date: null, ...changes,
});
const report: DsfHistoryReport = {
  format: 'DSFHISTORY1', available: true, served_at: '2026-11-11T23:01:00Z', timezone: 'America/Indiana/Indianapolis',
  from: '2026-11-11', to: '2026-11-11', group: 'hour', truncated: false, row_limit: 5000,
  rows: [row(15, 0), row(16, 4, { completeness: 'PARTIAL', covered_seconds: 1800 }), row(17, 99, { completeness: 'REVIEW', review_reason: 'identity' }), row(18, 77, { completeness: 'REVIEW', duplicate_operation: true })],
  totals: { count: null, known_subtotal: 4, complete_records: 1, partial_records: 1, unknown_records: 0, review_records: 2, excluded_duplicate_sources: 1 }, note: 'Sample records',
};

describe('Full production report evidence', () => {
  afterEach(() => TestBed.resetTestingModule());
  function create() {
    TestBed.configureTestingModule({ imports: [FullProductionReportComponent] });
    const fixture = TestBed.createComponent(FullProductionReportComponent);
    fixture.componentRef.setInput('source', source); fixture.componentRef.setInput('report', report); fixture.componentRef.setInput('date', '2026-11-11');
    fixture.detectChanges();
    return fixture;
  }

  it('shows verified zero and known partial counts while withholding missing, review and duplicate counts', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    const counts = host.querySelectorAll('tbody .full-report-count');
    expect(counts).toHaveLength(24);
    expect(counts[0].textContent?.trim()).toBe('—');
    expect(counts[10].textContent?.trim()).toBe('0');
    expect(counts[11].textContent).toContain('4');
    expect(counts[11].textContent).toContain('Known count');
    expect(counts[12].textContent?.trim()).toBe('—');
    expect(counts[13].textContent?.trim()).toBe('—');
    expect(host.querySelectorAll('[role="meter"]')).toHaveLength(2);
    expect(host.querySelector('[role="meter"][aria-valuenow="0"]')?.getAttribute('aria-valuetext')).toContain('0 recorded RUN pieces');
    expect(fixture.componentInstance.model().knownSubtotal).toBe(4);
    expect(fixture.componentInstance.model().totalCount).toBeNull();
    expect(host.textContent).toContain('Known subtotal · incomplete day');
  });

  it('labels unsupported DSF metrics unavailable rather than filling them with zero or inferred losses', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    const unavailable = Array.from(host.querySelectorAll('tbody tr')).map(item => Array.from(item.querySelectorAll('td.gear-muted')).map(cell => cell.textContent?.trim()));
    expect(unavailable.every(cells => cells.length === 6 && cells.every(value => value === 'Unavailable'))).toBe(true);
    expect(host.textContent).toContain('active part are unavailable');
    expect(host.textContent).toContain('their length does not indicate capacity or downtime');
    expect(host.textContent).toContain('Not confirmed');
  });

  it('does not borrow another source’s counts and exposes no fabricated zero when all requested history is missing', () => {
    const fixture = create();
    fixture.componentRef.setInput('source', { ...source, source_key: 'b'.repeat(64), source_name: 'Thread Draw 1' }); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.model().knownSubtotal).toBeNull();
    expect(fixture.componentInstance.firstRecordedHour()).toBeNull();
    expect(host.querySelectorAll('[role="meter"]')).toHaveLength(0);
    expect(Array.from(host.querySelectorAll('tbody .full-report-count')).every(cell => cell.textContent?.trim() === '—')).toBe(true);
  });
});
