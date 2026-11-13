import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlantHistoryDataService } from '@meshforge/manufacturing/frontend/data-access-plant-dashboard';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import type { DsfHistoryRecord, DsfHistoryReport } from '@meshforge/shared/domain';
import { HistoryComponent } from './history.component';

const missingDay: DsfHistoryRecord = {
  source_key: 'source-a', source_name: 'CutGrind 7', department_id: null, department_name: 'CUTTER GRIND',
  machine_number: null, asset_number: '1-24-80', duplicate_operation: false, review_reason: null,
  period_start: '2026-11-12T05:00:00Z', period_end: '2026-11-13T05:00:00Z', count: null,
  completeness: 'UNKNOWN', covered_seconds: 0, expected_seconds: 86400, observed_at: null,
  shift_id: null, shift_number: null, shift_date: null,
};
const report: DsfHistoryReport = {
  format: 'DSFHISTORY1', available: true, served_at: '2026-11-12T23:00:00Z', timezone: 'America/Indiana/Indianapolis',
  from: '2026-11-12', to: '2026-11-12', group: 'day', rows: [missingDay], truncated: false, row_limit: 5000,
  totals: { count: null, known_subtotal: 0, complete_records: 0, partial_records: 0, unknown_records: 1,
    review_records: 0, excluded_duplicate_sources: 0 }, note: 'Earlier hours have not been captured.',
};

describe('Plant count history presentation', () => {
  const saved = signal<DsfHistoryReport | null>(null);
  const data = {
    status: signal(null), report: saved, error: signal(''), statusError: signal(''), sourcesError: signal(''),
    loading: signal(false), sources: signal(null), filters: signal(null), applyFilters: jest.fn(), refresh: jest.fn(),
  };

  function create(): HistoryComponent {
    TestBed.configureTestingModule({ imports: [HistoryComponent], providers: [
      { provide: AuthSessionService, useValue: { logout: jest.fn() } },
      { provide: Router, useValue: { navigateByUrl: jest.fn() } },
    ] });
    TestBed.overrideComponent(HistoryComponent, { set: { template: '', providers: [{ provide: PlantHistoryDataService, useValue: data }] } });
    return TestBed.createComponent(HistoryComponent).componentInstance;
  }

  afterEach(() => { saved.set(null); data.applyFilters.mockClear(); TestBed.resetTestingModule(); });

  it('shows already captured production immediately without inventing a complete daily count', () => {
    const component = create();
    saved.set({ ...report, rows: [{ ...missingDay, covered_seconds: 5400, observed_at: report.served_at }],
      totals: { ...report.totals, known_subtotal: 42 } });
    expect(component.knownSubtotal()).toBe(42);
    const current = saved();
    if (!current) throw new Error('Expected the saved report fixture');
    expect(component.displayCount(current.rows[0])).toBeNull();
    expect(current.totals.count).toBeNull();
  });

  it('distinguishes uncaptured history from a verified zero and excludes review-only coverage', () => {
    const component = create();
    saved.set(report);
    expect(component.knownSubtotal()).toBeNull();
    saved.set({ ...report, rows: [{ ...missingDay, covered_seconds: 3600 }] });
    expect(component.knownSubtotal()).toBe(0);
    saved.set({ ...report, rows: [{ ...missingDay, completeness: 'REVIEW', covered_seconds: 3600 }] });
    expect(component.knownSubtotal()).toBeNull();
    saved.set({ ...report, rows: [{ ...missingDay, duplicate_operation: true, covered_seconds: 3600 }] });
    expect(component.knownSubtotal()).toBeNull();
    saved.set({ ...report, available: false, rows: [{ ...missingDay, covered_seconds: 3600 }] });
    expect(component.knownSubtotal()).toBeNull();
  });
});
