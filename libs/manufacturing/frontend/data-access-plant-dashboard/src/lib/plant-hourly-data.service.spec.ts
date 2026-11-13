import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import type { DsfHistoryCollectorStatus, DsfHistoryRecord, DsfHistoryReport, DsfHistorySource, DsfHistorySourceSnapshot } from '@meshforge/shared/domain';
import { PlantHourlyDataService, type PlantHourlyQuery, validatePlantHourlyQuery, validatePlantHourlyReport } from './plant-hourly-data.service';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const QUERY: PlantHourlyQuery = { date: '2026-11-11', source_keys: [A], include_inactive: false };
const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const source = (key: string): DsfHistorySource => ({ source_key: key, mapping_id: uuid(1), whiteboard_id: uuid(2), op_id: uuid(3),
  line_id: uuid(4), department_id: uuid(5), source_name: 'Machine ' + key.slice(0, 2), line_name: 'Line fixture', department_name: 'CUTTER GRIND',
  asset_number: '1-24-77', active: true, current: true, duplicate_operation: false, review_reason: null, machine_id: null,
  machine_number: null, last_seen_at: '2026-11-12T03:00:00Z' });
const SOURCES: DsfHistorySourceSnapshot = { format: 'DSFHISTORYSOURCES1', available: true, served_at: '2026-11-12T03:00:00Z', sources: [source(A), source(B)] };
const STATUS: DsfHistoryCollectorStatus = { format: 'DSFHISTORYSTATUS1', enabled: true, available: true, source_reader_enabled: true,
  interval_seconds: 60, lookback_days: 7, retention: 'indefinite', last_success_at: '2026-11-12T03:00:00Z', last_failure_at: null,
  last_failure_code: null, next_backfill_hour: '2026-11-11T19:00:00Z', backfill_start: '2026-11-05T00:00:00Z',
  source_count: 163, active_source_count: 117, earliest_hour: '2026-11-05T00:00:00Z', latest_covered_to: '2026-11-12T03:00:00Z', note: 'Collecting saved counts' };
const row = (key: string, parts = 0, date = QUERY.date): DsfHistoryRecord => ({ source_key: key, source_name: 'Machine ' + key.slice(0, 2),
  department_id: uuid(5), department_name: 'CUTTER GRIND', machine_number: null, asset_number: '1-24-77', duplicate_operation: false,
  review_reason: null, period_start: date + 'T20:00:00Z', period_end: date + 'T21:00:00Z', count: parts, completeness: 'COMPLETE',
  covered_seconds: 3600, expected_seconds: 3600, observed_at: '2026-11-12T03:00:00Z', shift_id: null, shift_number: null, shift_date: null });
const report = (key: string, parts = 0, date = QUERY.date): DsfHistoryReport => ({ format: 'DSFHISTORY1', available: true,
  served_at: '2026-11-12T03:00:00Z', timezone: 'America/Indiana/Indianapolis', from: date, to: date, group: 'hour', rows: [row(key, parts, date)],
  truncated: false, row_limit: 5000, totals: { count: parts, known_subtotal: parts, complete_records: 1, partial_records: 0,
    unknown_records: 0, review_records: 0, excluded_duplicate_sources: 0 }, note: 'Recorded RUN pieces' });

describe('hourly comparison query and evidence validation', () => {
  it('uses Indianapolis today rather than the UTC calendar date and copies the selection', () => {
    const input = { ...QUERY, date: '2026-11-12', source_keys: [A.toUpperCase()] };
    const accepted = validatePlantHourlyQuery(input, new Date('2026-11-13T03:00:00Z'));
    expect(accepted.source_keys).toEqual([A]);
    input.source_keys.push(B);
    expect(accepted.source_keys).toEqual([A]);
    expect(() => validatePlantHourlyQuery({ ...QUERY, date: '2026-11-13' }, new Date('2026-11-13T03:00:00Z'))).toThrow('up to today');
    expect(validatePlantHourlyQuery({ ...QUERY, source_keys: [] }).source_keys).toEqual([]);
    expect(validatePlantHourlyQuery({ ...QUERY, source_keys: ['a', 'b', 'c', 'd', 'e', 'f'].map(key => key.repeat(64)) }).source_keys).toHaveLength(6);
  });

  it.each([
    { ...QUERY, date: '2026-02-30' },
    { ...QUERY, date: '' },
    { ...QUERY, source_keys: [A, A.toUpperCase()] },
    { ...QUERY, source_keys: ['not-a-source'] },
    { ...QUERY, source_keys: ['a', 'b', 'c', 'd', 'e', 'f', '0'].map(key => key.repeat(64)) },
    { ...QUERY, include_inactive: 'true' as unknown as boolean },
  ])('rejects invalid or unbounded query input %#', input => {
    expect(() => validatePlantHourlyQuery(input)).toThrow();
  });

  it('preserves zero, unknown, partial and review as different evidence', () => {
    const input = report(A);
    input.rows.push({ ...row(A), period_start: QUERY.date + 'T21:00:00Z', period_end: QUERY.date + 'T22:00:00Z',
      count: null, completeness: 'UNKNOWN', covered_seconds: 0, observed_at: null });
    input.totals = { ...input.totals, count: null, unknown_records: 1 };
    expect(validatePlantHourlyReport(input, QUERY, A).rows.map(value => value.count)).toEqual([0, null]);
    const partial = report(A, 5);
    partial.rows[0] = { ...partial.rows[0], completeness: 'PARTIAL', covered_seconds: 900 };
    partial.totals = { ...partial.totals, count: null, complete_records: 0, partial_records: 1 };
    expect(validatePlantHourlyReport(partial, QUERY, A).rows[0].count).toBe(5);
    const review = report(A, 7);
    review.rows[0] = { ...review.rows[0], completeness: 'REVIEW', duplicate_operation: true, review_reason: 'DUPLICATE_OPERATION' };
    review.totals = { ...review.totals, count: null, known_subtotal: 0, complete_records: 0, review_records: 1, excluded_duplicate_sources: 1 };
    expect(validatePlantHourlyReport(review, QUERY, A).rows[0].completeness).toBe('REVIEW');
  });

  it.each([
    (input: DsfHistoryReport) => { input.from = '2026-11-10'; },
    (input: DsfHistoryReport) => { input.group = 'day'; },
    (input: DsfHistoryReport) => { input.rows[0].source_key = B; },
    (input: DsfHistoryReport) => { input.rows[0].count = -1; },
    (input: DsfHistoryReport) => { input.rows[0].count = Number.MAX_SAFE_INTEGER + 1; },
    (input: DsfHistoryReport) => { input.rows[0].count = null; },
    (input: DsfHistoryReport) => { input.rows[0].completeness = 'UNKNOWN'; },
    (input: DsfHistoryReport) => { input.rows[0].period_start = '2026-11-12T20:00:00Z'; },
    (input: DsfHistoryReport) => { input.rows[0].period_start = '2026-11-12T04:30:00Z'; input.rows[0].period_end = '2026-11-12T05:30:00Z'; },
    (input: DsfHistoryReport) => { input.rows[0].covered_seconds = 3599; },
    (input: DsfHistoryReport) => { input.rows[0].shift_id = '123'; },
    (input: DsfHistoryReport) => { input.rows.push({ ...input.rows[0] }); input.totals.complete_records = 2; },
    (input: DsfHistoryReport) => { input.totals.known_subtotal = 1; },
    (input: DsfHistoryReport) => { input.truncated = true; },
  ])('rejects wrong-scope or contradictory report evidence %#', mutate => {
    const input = report(A);
    mutate(input);
    expect(() => validatePlantHourlyReport(input, QUERY, A)).toThrow();
  });

  it('keeps repeated fall-back hours separate by their UTC boundaries', () => {
    const input = report(A, 3, '2026-11-01');
    input.rows = [{ ...row(A, 1), period_start: '2026-11-01T05:00:00Z', period_end: '2026-11-01T06:00:00Z' },
      { ...row(A, 2), period_start: '2026-11-01T06:00:00Z', period_end: '2026-11-01T07:00:00Z' }];
    input.totals.complete_records = 2;
    expect(validatePlantHourlyReport(input, { ...QUERY, date: '2026-11-01' }, A).rows).toHaveLength(2);
  });
});

describe('PlantHourlyDataService', () => {
  let http: HttpTestingController;

  function metadata(): void {
    const sources = http.expectOne(request => request.url === '/api/v1/dsf-counts/history/sources');
    expect(sources.request.params.get('include_inactive')).toBe('true');
    sources.flush(SOURCES);
    http.expectOne('/api/v1/dsf-counts/history/status').flush(STATUS);
  }

  function configure(): PlantHourlyDataService {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), PlantHourlyDataService] });
    http = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(PlantHourlyDataService);
    tick(0);
    metadata();
    return service;
  }

  const reports = () => http.match(request => request.url === '/api/v1/dsf-counts/history');
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('fetches independent reports only from the local archive, preserving a verified zero', fakeAsync(() => {
    const service = configure();
    service.applyQuery({ ...QUERY, source_keys: [A, B, C] });
    const requests = reports();
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.request.params.get('from')).toBe(QUERY.date);
      expect(request.request.params.get('to')).toBe(QUERY.date);
      expect(request.request.params.get('group')).toBe('hour');
      expect(request.request.params.get('include_inactive')).toBe('false');
    }
    requests[0].flush(report(A));
    requests[1].flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.loading()).toBe(true);
    requests[2].flush(report(C, 7));
    expect(service.results().map(result => [result.source_key, result.report?.rows[0].count ?? null, !!result.error]))
      .toEqual([[A, 0, false], [B, null, true], [C, 7, false]]);
    expect(service.loading()).toBe(false);
    http.expectNone('/api/v1/dsf-counts/admin-mappings');
    TestBed.resetTestingModule();
  }));

  it('cancels every old source request before a new date or selection can paint', fakeAsync(() => {
    const service = configure();
    service.applyQuery({ ...QUERY, source_keys: [A, B] });
    const previous = reports();
    const next = { ...QUERY, date: '2026-11-10', source_keys: [C], include_inactive: true };
    service.applyQuery(next);
    expect(previous.every(request => request.cancelled)).toBe(true);
    expect(service.results()).toEqual([]);
    expect(service.loading()).toBe(true);
    const request = reports()[0];
    expect(request.request.params.get('source_key')).toBe(C);
    expect(request.request.params.get('include_inactive')).toBe('true');
    request.flush(report(C, 4, next.date));
    expect(service.query()).toEqual(next);
    expect(service.results().map(result => result.source_key)).toEqual([C]);
    expect(() => previous[0].flush(report(A))).toThrow();
    TestBed.resetTestingModule();
  }));

  it('clears and cancels invalid or empty selections without sending an invalid request', fakeAsync(() => {
    const service = configure();
    service.applyQuery(QUERY);
    const pending = reports()[0];
    expect(() => service.applyQuery({ ...QUERY, source_keys: [A, A] })).toThrow();
    expect(pending.cancelled).toBe(true);
    expect(service.query()).toBeNull();
    expect(service.results()).toEqual([]);
    expect(service.loading()).toBe(false);
    expect(reports()).toEqual([]);
    service.applyQuery({ ...QUERY, source_keys: [] });
    tick(30000);
    metadata();
    expect(reports()).toEqual([]);
    expect(service.query()?.source_keys).toEqual([]);
    TestBed.resetTestingModule();
  }));

  it('caps a batch at six requests and does not retain a mutable caller selection', fakeAsync(() => {
    const service = configure();
    const selected = ['a', 'b', 'c', 'd', 'e', 'f'].map(key => key.repeat(64));
    const input = { ...QUERY, source_keys: selected };
    service.applyQuery(input);
    selected.pop();
    const requests = reports();
    expect(requests).toHaveLength(6);
    expect(service.query()?.source_keys).toHaveLength(6);
    requests.forEach(request => request.flush(report(request.request.params.get('source_key') ?? A)));
    expect(service.results()).toHaveLength(6);
    TestBed.resetTestingModule();
  }));

  it('times out a hung source so healthy charts publish, then recovers on the next poll', fakeAsync(() => {
    const service = configure();
    service.applyQuery({ ...QUERY, source_keys: [A, B] });
    const initial = reports();
    initial[0].flush(report(A, 7));
    tick(20000);
    expect(initial[1].cancelled).toBe(true);
    expect(service.results()[0].report?.rows[0].count).toBe(7);
    expect(service.results()[1].report).toBeNull();
    expect(service.results()[1].error).not.toBe('');
    expect(service.loading()).toBe(false);
    tick(10000);
    metadata();
    const retry = reports();
    expect(retry).toHaveLength(2);
    retry[0].flush(report(A, 8));
    retry[1].flush(report(B, 4));
    expect(service.results().map(result => result.error)).toEqual(['', '']);
    expect(service.results()[1].report?.rows[0].count).toBe(4);
    TestBed.resetTestingModule();
  }));

  it('keeps metadata failures and malformed source evidence separate from healthy reports', fakeAsync(() => {
    const service = configure();
    service.applyQuery({ ...QUERY, source_keys: [A, B] });
    const initial = reports();
    initial[0].flush(report(A, 3));
    initial[1].flush(report(C, 9));
    expect(service.results()[0].report?.rows[0].count).toBe(3);
    expect(service.results()[1].report).toBeNull();
    service.refresh();
    http.expectOne(request => request.url === '/api/v1/dsf-counts/history/sources').flush({ ...SOURCES, sources: [source(A), source(A)] });
    http.expectOne('/api/v1/dsf-counts/history/status').flush({}, { status: 503, statusText: 'Unavailable' });
    const refreshed = reports();
    refreshed[0].flush(report(A));
    refreshed[1].flush({}, { status: 403, statusText: 'Forbidden' });
    expect(service.sources()).toBeNull();
    expect(service.sourcesError()).not.toBe('');
    expect(service.status()).toBeNull();
    expect(service.statusError()).not.toBe('');
    expect(service.results()[0].report?.rows[0].count).toBe(0);
    expect(service.results()[1].error).toContain('does not have access');
    TestBed.resetTestingModule();
  }));

  it('tears down pending requests, timers and all session state when the component is left', fakeAsync(() => {
    const service = configure();
    service.applyQuery(QUERY);
    const pending = reports()[0];
    TestBed.resetTestingModule();
    expect(pending.cancelled).toBe(true);
    expect(service.query()).toBeNull();
    expect(service.results()).toEqual([]);
    expect(service.sources()).toBeNull();
    expect(service.status()).toBeNull();
    service.refresh();
    service.applyQuery(QUERY);
    tick(60000);
    http.verify();
    const next = configure();
    expect(next.query()).toBeNull();
    expect(next.results()).toEqual([]);
    expect(next.loading()).toBe(false);
    expect(reports()).toEqual([]);
    TestBed.resetTestingModule();
  }));
});
