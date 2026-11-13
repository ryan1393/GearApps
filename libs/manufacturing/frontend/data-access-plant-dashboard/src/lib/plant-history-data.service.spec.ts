import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import type { DsfHistoryCollectorStatus, DsfHistoryRecord, DsfHistoryReport, DsfHistorySourceSnapshot } from '@meshforge/shared/domain';
import { PlantHistoryDataService, type PlantHistoryQuery } from './plant-history-data.service';

const query: PlantHistoryQuery = { from: '2026-11-11', to: '2026-11-11', group: 'day', source_key: '', department_id: '', include_inactive: false };
const status: DsfHistoryCollectorStatus = { format: 'DSFHISTORYSTATUS1', enabled: true, available: true, source_reader_enabled: true,
  interval_seconds: 60, lookback_days: 7, retention: 'indefinite', last_success_at: '2026-11-12T03:00:00Z',
  last_failure_at: null, last_failure_code: null, next_backfill_hour: '2026-11-11T19:00:00Z', backfill_start: '2026-11-05T00:00:00Z',
  source_count: 163, active_source_count: 117, earliest_hour: '2026-11-05T00:00:00Z', latest_covered_to: '2026-11-12T03:00:00Z', note: 'Collecting saved counts' };
const sources: DsfHistorySourceSnapshot = { format: 'DSFHISTORYSOURCES1', available: true, served_at: '2026-11-12T03:00:00Z', sources: [] };
const row: DsfHistoryRecord = { source_key: 'source-a', source_name: 'CutGrind 7', department_id: null,
  department_name: 'CUTTER GRIND', machine_number: null, asset_number: '1-24-80', duplicate_operation: false,
  review_reason: null, period_start: '2026-11-11T20:00:00Z', period_end: '2026-11-11T21:00:00Z',
  count: 0, completeness: 'COMPLETE', covered_seconds: 3600, expected_seconds: 3600,
  observed_at: '2026-11-12T03:00:00Z', shift_id: null, shift_number: null, shift_date: null };
const report: DsfHistoryReport = { format: 'DSFHISTORY1', available: true, served_at: '2026-11-12T03:00:00Z',
  timezone: 'America/Indiana/Indianapolis', from: query.from, to: query.to, group: query.group,
  rows: [row, { ...row, source_key: 'source-b', source_name: 'No capture', count: null, completeness: 'UNKNOWN', covered_seconds: 0, observed_at: null }],
  truncated: false, row_limit: 5000, totals: { count: null, known_subtotal: 0, complete_records: 1, partial_records: 0,
    unknown_records: 1, review_records: 0, excluded_duplicate_sources: 0 }, note: 'Unknown is not zero' };

describe('PlantHistoryDataService', () => {
  let http: HttpTestingController;

  function configure(): PlantHistoryDataService {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), PlantHistoryDataService] });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(PlantHistoryDataService);
  }

  function metadata(): void {
    http.expectOne('/api/v1/dsf-counts/history/status').flush(status);
    const request = http.expectOne(request => request.url === '/api/v1/dsf-counts/history/sources');
    expect(request.request.params.get('include_inactive')).toBe('true');
    request.flush(sources);
  }

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('keeps verified zero distinct from an uncaptured period and reads no administrator-only endpoint', fakeAsync(() => {
    const service = configure();
    service.applyFilters(query);
    const request = http.expectOne(request => request.url === '/api/v1/dsf-counts/history');
    expect(request.request.params.get('from')).toBe(query.from);
    expect(request.request.params.get('to')).toBe(query.to);
    expect(request.request.params.get('include_inactive')).toBe('false');
    request.flush(report);
    tick(0);
    metadata();
    expect(service.report()?.rows.map(row => row.count)).toEqual([0, null]);
    expect(service.status()).toEqual(status);
    expect(service.loading()).toBe(false);
    http.expectNone('/api/v1/dsf-counts/admin-mappings');
    TestBed.resetTestingModule();
  }));

  it('cancels an old filter request so it cannot overwrite a newer source report', fakeAsync(() => {
    const service = configure();
    service.applyFilters(query);
    const previous = http.expectOne(request => request.url === '/api/v1/dsf-counts/history');
    const next = { ...query, group: 'hour' as const, source_key: 'source-a', department_id: 'department-a', include_inactive: true };
    service.applyFilters(next);
    expect(previous.cancelled).toBe(true);
    const request = http.expectOne(request => request.url === '/api/v1/dsf-counts/history');
    expect(request.request.params.get('source_key')).toBe('source-a');
    expect(request.request.params.get('department_id')).toBe('department-a');
    expect(request.request.params.get('group')).toBe('hour');
    expect(request.request.params.get('include_inactive')).toBe('true');
    request.flush({ ...report, group: 'hour', rows: [row] });
    expect(service.filters()).toEqual(next);
    expect(service.report()?.rows).toEqual([row]);
    tick(0);
    metadata();
    TestBed.resetTestingModule();
  }));

  it('recovers a failed archive request and keeps metadata failures separate from saved counts', fakeAsync(() => {
    const service = configure();
    service.applyFilters(query);
    http.expectOne(request => request.url === '/api/v1/dsf-counts/history').flush({}, { status: 503, statusText: 'Unavailable' });
    tick(0);
    http.expectOne('/api/v1/dsf-counts/history/status').flush({}, { status: 503, statusText: 'Unavailable' });
    http.expectOne(request => request.url === '/api/v1/dsf-counts/history/sources').flush(sources);
    expect(service.report()).toBeNull();
    expect(service.error()).toContain('unavailable');
    expect(service.statusError()).toContain('status is unavailable');
    service.refresh();
    metadata();
    http.expectOne(request => request.url === '/api/v1/dsf-counts/history').flush(report);
    expect(service.error()).toBe('');
    expect(service.statusError()).toBe('');
    expect(service.report()).toEqual(report);
    TestBed.resetTestingModule();
  }));

  it('rejects malformed count evidence and stops all polling when the screen scope is destroyed', fakeAsync(() => {
    const service = configure();
    service.applyFilters(query);
    http.expectOne(request => request.url === '/api/v1/dsf-counts/history').flush({ ...report, rows: [{ ...row, count: -1 }] });
    expect(service.report()).toBeNull();
    expect(service.error()).toContain('unavailable');
    tick(0);
    metadata();
    tick(30000);
    metadata();
    const pending = http.expectOne(request => request.url === '/api/v1/dsf-counts/history');
    TestBed.resetTestingModule();
    expect(pending.cancelled).toBe(true);
    tick(60000);
    http.verify();
  }));

  it('does not reuse a prior user scope or export old evidence after authorization is lost', fakeAsync(() => {
    const service = configure();
    service.applyFilters(query);
    http.expectOne(request => request.url === '/api/v1/dsf-counts/history').flush(report);
    tick(0);
    metadata();
    service.refresh();
    metadata();
    http.expectOne(request => request.url === '/api/v1/dsf-counts/history').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(service.report()).toBeNull();
    expect(service.error()).toContain('does not have access');
    TestBed.resetTestingModule();
    const next = configure();
    expect(next.report()).toBeNull();
    expect(next.sources()).toBeNull();
    expect(next.filters()).toBeNull();
    tick(0);
    metadata();
    http.expectNone(request => request.url === '/api/v1/dsf-counts/history');
    TestBed.resetTestingModule();
  }));
});
