import { HttpClient } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { API_BASE_URL } from '@gearapps/client/core';
import { catchError, map, of, startWith, switchMap, timer } from 'rxjs';

export type HealthState = 'checking' | 'ready' | 'degraded' | 'offline';

/** Polls the API health endpoint for the topbar status pill. */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/health`;

  readonly state = signal<HealthState>('checking');
  readonly detail = signal('Checking API and database…');

  constructor() {
    timer(0, 30_000)
      .pipe(
        switchMap(() =>
          this.http
            .get<{ status: string; info?: Record<string, { status: string }> }>(this.url)
            .pipe(
              map((h) => ({
                ok: h.status === 'ok',
                detail: Object.entries(h.info ?? {})
                  .map(([k, v]) => `${k}: ${v.status}`)
                  .join(' · '),
              })),
              catchError((err) =>
                of({
                  ok: false,
                  detail: err?.status ? `API responded ${err.status}` : 'API unreachable',
                  offline: !err?.status,
                }),
              ),
            ),
        ),
        startWith(null),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((r) => {
        if (!r) return;
        this.state.set(r.ok ? 'ready' : 'offline' in r && r.offline ? 'offline' : 'degraded');
        this.detail.set(r.detail || (r.ok ? 'Database up' : 'Service degraded'));
      });
  }

  get label() {
    return {
      checking: 'Checking system',
      ready: 'System ready',
      degraded: 'System degraded',
      offline: 'System offline',
    }[this.state()];
  }

  get tone() {
    return { checking: null, ready: 'success', degraded: 'warning', offline: 'danger' }[
      this.state()
    ];
  }
}
