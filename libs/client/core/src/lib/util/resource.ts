import { signal, Signal, WritableSignal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

export interface Loadable<T> {
  readonly value: Signal<T>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<unknown | null>;
  /** (Re)load from the given observable; cancels any previous in-flight load. */
  load(source: Observable<T>): void;
  set(value: T): void;
  update(fn: (current: T) => T): void;
}

/**
 * Minimal signal-based async state holder for list/detail data: value + loading + error.
 * Keeps feature components free of BehaviorSubject plumbing.
 */
export function loadable<T>(initial: T): Loadable<T> {
  const value: WritableSignal<T> = signal(initial);
  const loading = signal(false);
  const error = signal<unknown | null>(null);
  let sub: Subscription | null = null;

  return {
    value: value.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    load(source) {
      sub?.unsubscribe();
      loading.set(true);
      error.set(null);
      sub = source.subscribe({
        next: (v) => {
          value.set(v);
          loading.set(false);
        },
        error: (e) => {
          error.set(e);
          loading.set(false);
        },
      });
    },
    set: (v) => { sub?.unsubscribe(); sub = null; loading.set(false); error.set(null); value.set(v); },
    update: (fn) => value.update(fn),
  };
}
