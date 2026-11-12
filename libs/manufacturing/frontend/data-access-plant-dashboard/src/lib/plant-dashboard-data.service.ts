import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import type { DsfMappingSnapshot, ProductionSnapshot } from '@meshforge/shared/domain';
import { Subject, catchError, exhaustMap, finalize, map, merge, of, timer } from 'rxjs';

/** Component-scoped: polling and cached admin data end when the dashboard is left. */
@Injectable()
export class PlantDashboardDataService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly destroy = inject(DestroyRef);
  private readonly refreshRequests = new Subject<void>();
  private readonly boardState = signal<ProductionSnapshot | null>(null);
  private readonly errorState = signal('');
  private readonly loadingState = signal(true);
  private readonly mappingState = signal<DsfMappingSnapshot | null>(null);
  private readonly mappingErrorState = signal('');
  readonly board = this.boardState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly mappingBoard = this.mappingState.asReadonly();
  readonly mappingError = this.mappingErrorState.asReadonly();
  readonly isAdmin = String(this.session.currentUser?.role ?? '').toLowerCase() === 'admin';

  constructor() {
    if (this.isAdmin) {
      merge(timer(0, 30000), this.refreshRequests).pipe(
        exhaustMap(() => this.http.get<DsfMappingSnapshot>('/api/v1/dsf-counts/admin-mappings').pipe(
          map(board => {
            if (board.format !== 'DSFMAPADMIN1' || !Array.isArray(board.source_options)) throw new Error('Unsupported source catalog');
            return { board, error: '' };
          }),
          catchError(() => of({ board: null, error: 'DSF source coverage is unavailable. Retrying automatically.' })),
        )),
        takeUntilDestroyed(this.destroy),
      ).subscribe(state => { this.mappingState.set(state.board); this.mappingErrorState.set(state.error); });
    }
    merge(timer(0, 30000), this.refreshRequests).pipe(
      exhaustMap(() => {
        this.loadingState.set(true);
        return this.http.get<ProductionSnapshot>('/api/v1/dsf-counts').pipe(
          map(board => {
            if (board.format !== 'DSFCOUNT1' || !Array.isArray(board.rows)) throw new Error('Unsupported source response');
            return { board, error: '' };
          }),
          catchError((error: unknown) => of({ board: null, error: error instanceof HttpErrorResponse && error.status === 403
            ? 'Your MeshForge account does not have access to machine counts.'
            : 'Machine data is unavailable. Retrying automatically. Check that MeshForge is running.' })),
          finalize(() => this.loadingState.set(false)),
        );
      }),
      takeUntilDestroyed(this.destroy),
    ).subscribe(state => { this.boardState.set(state.board); this.errorState.set(state.error); });
  }

  refresh(): void { this.refreshRequests.next(); }
}
