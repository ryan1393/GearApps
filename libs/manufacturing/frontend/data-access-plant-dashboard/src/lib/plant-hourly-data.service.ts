import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { DsfHistoryCollectorStatus, DsfHistoryReport, DsfHistorySourceSnapshot } from '@meshforge/shared/domain';
import { Subject, catchError, finalize, forkJoin, map, merge, of, switchMap, timeout, timer } from 'rxjs';

export interface PlantHourlyQuery {
  date: string;
  source_keys: string[];
  include_inactive: boolean;
}

export interface PlantHourlySourceResult {
  source_key: string;
  report: DsfHistoryReport | null;
  error: string;
}

const HASH = /^[a-f0-9]{64}$/;
const PLANT_ZONE = 'America/Indiana/Indianapolis';
const plantCalendar = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const plantDate = (date: Date): string => {
  const parts = plantCalendar.formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value ?? '').join('-');
};
const civilDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d\d-\d\d$/.test(date) &&
  Number(date.slice(0, 4)) > 0 && Number.isFinite(Date.parse(date + 'T00:00:00Z')) &&
  new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
const isoDate = (date: unknown): date is string => typeof date === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(date) && Number.isFinite(Date.parse(date));
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableCount = (value: unknown): boolean => value === null || count(value);
const nullableDate = (value: unknown): boolean => value === null || isoDate(value);
const nullableText = (value: unknown): boolean => value === null || typeof value === 'string';

/** Validate and copy selection state before it becomes an HTTP query. */
export function validatePlantHourlyQuery(value: PlantHourlyQuery, now = new Date()): PlantHourlyQuery {
  if (!value || !civilDate(value.date) || value.date > plantDate(now)) throw new Error('Choose a valid date up to today in Indianapolis.');
  if (!Array.isArray(value.source_keys) || value.source_keys.length > 6) throw new Error('Choose no more than six machines.');
  const keys = value.source_keys.map(key => typeof key === 'string' ? key.toLowerCase() : '');
  if (keys.some(key => !HASH.test(key)) || new Set(keys).size !== keys.length) throw new Error('Choose each machine once from the source list.');
  if (typeof value.include_inactive !== 'boolean') throw new Error('Choose whether inactive sources should be included.');
  Object.freeze(keys);
  return Object.freeze({ date: value.date, source_keys: keys, include_inactive: value.include_inactive });
}

/** One machine and calendar date must never receive another query's response. */
export function validatePlantHourlyReport(value: DsfHistoryReport, query: PlantHourlyQuery, sourceKey: string): DsfHistoryReport {
  if (!value || value.format !== 'DSFHISTORY1' || typeof value.available !== 'boolean' || !isoDate(value.served_at) ||
      value.timezone !== PLANT_ZONE || value.from !== query.date || value.to !== query.date || value.group !== 'hour' ||
      typeof value.truncated !== 'boolean' || value.truncated || !count(value.row_limit) || value.row_limit < 1 || value.row_limit > 5000 ||
      !Array.isArray(value.rows) || value.rows.length > Math.min(25, value.row_limit) || !value.totals || typeof value.note !== 'string') {
    throw new Error('Unsupported hourly report scope');
  }
  let known = 0;
  const seen = new Set<number>();
  const states = { COMPLETE: 0, PARTIAL: 0, UNKNOWN: 0, REVIEW: 0 };
  let duplicate = false;
  for (const row of value.rows) {
    if (!row || row.source_key !== sourceKey || typeof row.source_name !== 'string' || typeof row.department_name !== 'string' ||
        !nullableText(row.department_id) || !nullableText(row.machine_number) || !nullableText(row.asset_number) ||
        typeof row.duplicate_operation !== 'boolean' || !nullableText(row.review_reason) || !nullableCount(row.count) ||
        !Object.hasOwn(states, row.completeness) || !isoDate(row.period_start) || !isoDate(row.period_end) ||
        row.shift_id !== null || row.shift_number !== null || row.shift_date !== null ||
        typeof row.covered_seconds !== 'number' || !Number.isFinite(row.covered_seconds) || row.covered_seconds < 0 || row.covered_seconds > 3600 ||
        row.expected_seconds !== 3600 || !nullableDate(row.observed_at) || row.count !== null && row.observed_at === null) {
      throw new Error('Unsupported hourly count evidence');
    }
    const start = Date.parse(row.period_start), end = Date.parse(row.period_end);
    if (end - start !== 3600000 || plantDate(new Date(start)) !== query.date || plantDate(new Date(end - 1)) !== query.date || seen.has(start) ||
        row.completeness === 'UNKNOWN' && row.count !== null ||
        row.completeness === 'COMPLETE' && (row.count === null || row.covered_seconds !== 3600) ||
        row.completeness === 'PARTIAL' && (row.count === null || row.covered_seconds <= 0 || row.covered_seconds >= 3600) ||
        (row.duplicate_operation || row.review_reason !== null) && row.completeness !== 'REVIEW') {
      throw new Error('Contradictory hourly coverage');
    }
    states[row.completeness]++;
    duplicate ||= row.duplicate_operation;
    if (!row.duplicate_operation && row.completeness !== 'REVIEW') known += row.count ?? 0;
    if (!count(known)) throw new Error('Hourly count precision exceeded');
    seen.add(start);
  }
  const totals = value.totals;
  if (!nullableCount(totals.count) || !count(totals.known_subtotal) || totals.known_subtotal !== known ||
      totals.complete_records !== states.COMPLETE || totals.partial_records !== states.PARTIAL ||
      totals.unknown_records !== states.UNKNOWN || totals.review_records !== states.REVIEW ||
      totals.excluded_duplicate_sources !== (duplicate ? 1 : 0) ||
      totals.count !== (value.rows.length && !states.PARTIAL && !states.UNKNOWN && !states.REVIEW ? known : null) ||
      !value.available && value.rows.length > 0) throw new Error('Contradictory hourly totals');
  return value;
}

function validStatus(value: DsfHistoryCollectorStatus): boolean {
  return !!value && value.format === 'DSFHISTORYSTATUS1' && typeof value.enabled === 'boolean' && typeof value.available === 'boolean' &&
    typeof value.source_reader_enabled === 'boolean' && value.retention === 'indefinite' && count(value.interval_seconds) &&
    value.interval_seconds >= 30 && value.interval_seconds <= 3600 && count(value.lookback_days) && value.lookback_days >= 1 && value.lookback_days <= 31 &&
    count(value.source_count) && count(value.active_source_count) && value.active_source_count <= value.source_count &&
    [value.last_success_at, value.last_failure_at, value.next_backfill_hour, value.backfill_start, value.earliest_hour, value.latest_covered_to].every(nullableDate) &&
    nullableText(value.last_failure_code) && typeof value.note === 'string';
}

function validSources(value: DsfHistorySourceSnapshot): boolean {
  if (!value || value.format !== 'DSFHISTORYSOURCES1' || typeof value.available !== 'boolean' || !isoDate(value.served_at) ||
      !Array.isArray(value.sources) || value.sources.length > 5000 || !value.available && value.sources.length > 0) return false;
  const seen = new Set<string>();
  return value.sources.every(source => {
    if (!source || !HASH.test(source.source_key) || seen.has(source.source_key) || typeof source.source_name !== 'string' ||
        typeof source.line_name !== 'string' || typeof source.department_name !== 'string' || typeof source.active !== 'boolean' ||
        typeof source.current !== 'boolean' || typeof source.duplicate_operation !== 'boolean' || !nullableText(source.review_reason) ||
        !nullableText(source.asset_number) || !nullableText(source.machine_id) || !nullableText(source.machine_number) || !isoDate(source.last_seen_at)) return false;
    seen.add(source.source_key);
    return true;
  });
}

/** Component-scoped comparison data: archive HTTP reads only, with no shared session cache. */
@Injectable()
export class PlantHourlyDataService {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly metadataRefresh = new Subject<void>();
  private readonly reportRefresh = new Subject<void>();
  private readonly sourcesState = signal<DsfHistorySourceSnapshot | null>(null);
  private readonly sourcesErrorState = signal('');
  private readonly statusState = signal<DsfHistoryCollectorStatus | null>(null);
  private readonly statusErrorState = signal('');
  private readonly resultsState = signal<PlantHourlySourceResult[]>([]);
  private readonly loadingState = signal(false);
  private readonly queryState = signal<PlantHourlyQuery | null>(null);
  private stopped = false;

  readonly sources = this.sourcesState.asReadonly();
  readonly sourcesError = this.sourcesErrorState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly statusError = this.statusErrorState.asReadonly();
  readonly results = this.resultsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly query = this.queryState.asReadonly();

  constructor() {
    merge(timer(0, 30000), this.metadataRefresh).pipe(
      switchMap(() => this.http.get<DsfHistorySourceSnapshot>('/api/v1/dsf-counts/history/sources', {
        params: new HttpParams().set('include_inactive', 'true'),
      }).pipe(
        timeout({ first: 20000 }),
        map(sources => { if (!validSources(sources)) throw new Error('Unsupported sources'); return { sources, error: '' }; }),
        catchError(() => of({ sources: null, error: 'The saved machine source list is unavailable. Try refreshing.' })),
      )), takeUntilDestroyed(this.destroy),
    ).subscribe(value => { this.sourcesState.set(value.sources); this.sourcesErrorState.set(value.error); });

    merge(timer(0, 30000), this.metadataRefresh).pipe(
      switchMap(() => this.http.get<DsfHistoryCollectorStatus>('/api/v1/dsf-counts/history/status').pipe(
        timeout({ first: 20000 }),
        map(status => { if (!validStatus(status)) throw new Error('Unsupported status'); return { status, error: '' }; }),
        catchError(() => of({ status: null, error: 'Collection status is unavailable. Saved hourly counts can still be viewed.' })),
      )), takeUntilDestroyed(this.destroy),
    ).subscribe(value => { this.statusState.set(value.status); this.statusErrorState.set(value.error); });

    merge(timer(30000, 30000), this.reportRefresh).pipe(
      switchMap(() => {
        const query = this.queryState();
        if (!query?.source_keys.length) { this.loadingState.set(false); return of<PlantHourlySourceResult[]>([]); }
        this.loadingState.set(true);
        return forkJoin(query.source_keys.map(sourceKey => this.http.get<DsfHistoryReport>('/api/v1/dsf-counts/history', {
          params: new HttpParams().set('from', query.date).set('to', query.date).set('group', 'hour')
            .set('source_key', sourceKey).set('include_inactive', String(query.include_inactive)),
        }).pipe(
          timeout({ first: 20000 }),
          map(value => ({ source_key: sourceKey, report: validatePlantHourlyReport(value, query, sourceKey), error: '' })),
          catchError((error: unknown) => of({ source_key: sourceKey, report: null,
            error: error instanceof HttpErrorResponse && [401, 403].includes(error.status)
              ? 'Your MeshForge account does not have access to these hourly counts.'
              : 'Saved hourly counts could not be verified for this machine and date. Try refreshing.' })),
        ))).pipe(finalize(() => this.loadingState.set(false)));
      }), takeUntilDestroyed(this.destroy),
    ).subscribe(results => this.resultsState.set(results));

    this.destroy.onDestroy(() => {
      this.stopped = true;
      this.queryState.set(null); this.resultsState.set([]); this.loadingState.set(false);
      this.sourcesState.set(null); this.sourcesErrorState.set(''); this.statusState.set(null); this.statusErrorState.set('');
    });
  }

  applyQuery(query: PlantHourlyQuery): void {
    if (this.stopped) return;
    try {
      const next = validatePlantHourlyQuery(query);
      this.queryState.set(next); this.resultsState.set([]);
      this.reportRefresh.next();
    } catch (error) {
      this.queryState.set(null); this.resultsState.set([]);
      this.reportRefresh.next();
      throw error;
    }
  }

  refresh(): void {
    if (this.stopped) return;
    this.metadataRefresh.next(); this.reportRefresh.next();
  }
}
