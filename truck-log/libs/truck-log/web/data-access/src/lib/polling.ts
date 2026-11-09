import { DestroyRef, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, exhaustMap, map, of, switchMap, timeout, timer } from 'rxjs';

export interface PollerOptions<T> {
  /** Time between the end of one tick's start and the next tick. */
  intervalMs: number;
  /** Builds the request for the current parameters (read at every tick). */
  load: () => Observable<T>;
  /** Applied only for the newest successful response. */
  next: (value: T) => void;
  /** Called on failure; `initial` is true while no response has ever succeeded. */
  error?: (error: unknown, context: { initial: boolean; manual: boolean }) => void;
  destroyRef: DestroyRef;
  /** A hung request must not block later ticks forever. Default: max(15s, 2 x interval). */
  timeoutMs?: number;
  /** Start immediately (default true). */
  start?: boolean;
  /** Return false to skip a background tick (for example while an edit is in progress). */
  when?: () => boolean;
}

interface Outcome<T> { ok: boolean; value?: T; error?: unknown; manual: boolean }

/**
 * One polling loop per screen:
 *   restart (manual refresh or changed parameters) --switchMap--> timer(0, interval) --exhaustMap--> request
 * - background ticks never overlap (exhaustMap);
 * - a manual refresh cancels the in-flight request so the newest parameters win (switchMap);
 * - torn down with the component (takeUntilDestroyed);
 * - lastUpdated only advances on success; any failure marks the data stale.
 */
export class Poller<T> {
  readonly lastUpdated = signal<Date | null>(null);
  /** True after a failed refresh until the next success: the screen shows data that may be out of date. */
  readonly stale = signal(false);
  readonly loading = signal(false);
  readonly lastError = signal<unknown>(null);
  private readonly restart$ = new Subject<{ manual: boolean; delayed: boolean }>();

  constructor(private readonly options: PollerOptions<T>) {
    const timeoutMs = options.timeoutMs ?? Math.max(15000, options.intervalMs * 2);
    this.restart$.pipe(
      switchMap((start) => timer(start.delayed ? options.intervalMs : 0, options.intervalMs).pipe(
        exhaustMap((tick) => {
          const manual = start.manual && tick === 0;
          if (!manual && options.when && !options.when()) return of(null);
          this.loading.set(true);
          return options.load().pipe(
            timeout(timeoutMs),
            map((value): Outcome<T> => ({ ok: true, value, manual })),
            catchError((error: unknown) => of<Outcome<T>>({ ok: false, error, manual })),
          );
        }),
      )),
      takeUntilDestroyed(options.destroyRef),
    ).subscribe((outcome: Outcome<T> | null) => {
      if (!outcome) return;
      this.loading.set(false);
      if (outcome.ok) {
        this.lastUpdated.set(new Date());
        this.stale.set(false);
        this.lastError.set(null);
        options.next(outcome.value as T);
      } else {
        const initial = !this.lastUpdated();
        this.stale.set(true);
        this.lastError.set(outcome.error);
        options.error?.(outcome.error, { initial, manual: outcome.manual });
      }
    });
    if (options.start !== false) this.restart$.next({ manual: false, delayed: false });
  }

  /** Load now with the current parameters, cancelling any older in-flight request, then keep polling. */
  refresh() {
    this.restart$.next({ manual: true, delayed: false });
  }

  /** (Re)start background polling with the first request one interval from now. */
  schedule() {
    this.restart$.next({ manual: false, delayed: true });
  }

  /** True once data has loaded at least once. */
  hasData() {
    return !!this.lastUpdated();
  }
}

export function createPoller<T>(options: PollerOptions<T>): Poller<T> {
  return new Poller(options);
}

/** Best operator-facing message from an HTTP error. */
export function httpErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message) && message.length) return message.join(' ');
  return fallback;
}
