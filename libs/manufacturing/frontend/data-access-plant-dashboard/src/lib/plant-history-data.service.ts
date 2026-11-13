import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { DsfHistoryCollectorStatus, DsfHistoryGroup, DsfHistoryReport, DsfHistorySourceSnapshot } from '@meshforge/shared/domain';
import { EMPTY, Subject, catchError, finalize, map, merge, of, switchMap, timer } from 'rxjs';

/** HTTP query shape. Date validation belongs to the pure report utilities and API. */
export interface PlantHistoryQuery {
  from: string;
  to: string;
  group: DsfHistoryGroup;
  source_key: string;
  department_id: string;
  include_inactive: boolean;
}

/** Scoped to the history screen: reads MeshForge's archive and stops on navigation/sign-out. */
@Injectable()
export class PlantHistoryDataService {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly metadataRefresh = new Subject<void>();
  private readonly reportRefresh = new Subject<void>();
  private readonly statusState = signal<DsfHistoryCollectorStatus | null>(null);
  private readonly sourcesState = signal<DsfHistorySourceSnapshot | null>(null);
  private readonly reportState = signal<DsfHistoryReport | null>(null);
  private readonly filtersState = signal<PlantHistoryQuery | null>(null);
  private readonly statusErrorState = signal('');
  private readonly sourcesErrorState = signal('');
  private readonly errorState = signal('');
  private readonly loadingState = signal(false);

  readonly status = this.statusState.asReadonly();
  readonly sources = this.sourcesState.asReadonly();
  readonly report = this.reportState.asReadonly();
  readonly filters = this.filtersState.asReadonly();
  readonly statusError = this.statusErrorState.asReadonly();
  readonly sourcesError = this.sourcesErrorState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  constructor() {
    merge(timer(0, 30000), this.metadataRefresh).pipe(
      switchMap(() => this.http.get<DsfHistoryCollectorStatus>('/api/v1/dsf-counts/history/status').pipe(
        map(status => {
          if (status.format !== 'DSFHISTORYSTATUS1' || typeof status.enabled !== 'boolean' || typeof status.available !== 'boolean') {
            throw new Error('Unsupported history status');
          }
          return { status, error: '' };
        }),
        catchError(() => of({ status: null, error: 'Collection status is unavailable. Saved records can still be viewed below.' })),
      )),
      takeUntilDestroyed(this.destroy),
    ).subscribe(result => { this.statusState.set(result.status); this.statusErrorState.set(result.error); });

    merge(timer(0, 30000), this.metadataRefresh).pipe(
      switchMap(() => this.http.get<DsfHistorySourceSnapshot>('/api/v1/dsf-counts/history/sources', {
        params: new HttpParams().set('include_inactive', 'true'),
      }).pipe(
        map(sources => {
          if (sources.format !== 'DSFHISTORYSOURCES1' || !Array.isArray(sources.sources)) throw new Error('Unsupported history sources');
          return { sources, error: '' };
        }),
        catchError(() => of({ sources: null, error: 'The saved source catalog is unavailable. Try refreshing the report.' })),
      )),
      takeUntilDestroyed(this.destroy),
    ).subscribe(result => { this.sourcesState.set(result.sources); this.sourcesErrorState.set(result.error); });

    merge(timer(30000, 30000), this.reportRefresh).pipe(
      switchMap(() => {
        const filters = this.filtersState();
        if (!filters) return EMPTY;
        let params = new HttpParams().set('from', filters.from).set('to', filters.to)
          .set('group', filters.group).set('include_inactive', String(filters.include_inactive));
        if (filters.source_key) params = params.set('source_key', filters.source_key);
        if (filters.department_id) params = params.set('department_id', filters.department_id);
        this.loadingState.set(true);
        return this.http.get<DsfHistoryReport>('/api/v1/dsf-counts/history', { params }).pipe(
          map(report => {
            const validCount = (count: number | null) => count === null || Number.isSafeInteger(count) && count >= 0;
            if (report.format !== 'DSFHISTORY1' || !Array.isArray(report.rows) || !report.totals ||
                !validCount(report.totals.count) || !Number.isSafeInteger(report.totals.known_subtotal) || report.totals.known_subtotal < 0 ||
                report.rows.some(row => !validCount(row.count) || !['COMPLETE', 'PARTIAL', 'UNKNOWN', 'REVIEW'].includes(row.completeness) ||
                  row.completeness === 'UNKNOWN' && row.count !== null || row.completeness === 'COMPLETE' && row.count === null)) {
              throw new Error('Unsupported count history');
            }
            return { report, error: '' };
          }),
          catchError((error: unknown) => of({ report: null, error: error instanceof HttpErrorResponse && error.status === 403
            ? 'Your MeshForge account does not have access to count history.'
            : 'Saved count history is unavailable. Try refreshing after MeshForge is available.' })),
          finalize(() => this.loadingState.set(false)),
        );
      }),
      takeUntilDestroyed(this.destroy),
    ).subscribe(result => { this.reportState.set(result.report); this.errorState.set(result.error); });
  }

  applyFilters(filters: PlantHistoryQuery): void {
    this.filtersState.set({ ...filters });
    this.reportState.set(null);
    this.errorState.set('');
    this.reportRefresh.next();
  }

  refresh(): void {
    this.metadataRefresh.next();
    this.reportRefresh.next();
  }
}
