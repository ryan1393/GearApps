import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface ToastNotice {
  id: number;
  tone: ToastTone;
  title: string;
  message: string;
  /** 0 = stays until the operator dismisses it. */
  durationMs: number;
}

const MAX_VISIBLE = 4;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly noticesSubject = new BehaviorSubject<ToastNotice[]>([]);
  readonly notices$ = this.noticesSubject.asObservable();

  success(message: string, title = 'Done', durationMs = 4500) {
    this.show('success', title, message, durationMs);
  }

  warning(message: string, title = 'Attention', durationMs = 6500) {
    this.show('warning', title, message, durationMs);
  }

  /** Errors stay on screen until dismissed so an operator cannot miss them. */
  error(message: string, title = 'Something went wrong', durationMs = 0) {
    this.show('error', title, message, durationMs);
  }

  info(message: string, title = 'Notice', durationMs = 5000) {
    this.show('info', title, message, durationMs);
  }

  dismiss(id: number) {
    this.noticesSubject.next(this.noticesSubject.value.filter((notice) => notice.id !== id));
  }

  private show(tone: ToastTone, title: string, message: string, durationMs: number) {
    // A repeated failure (for example a background refresh) shows once, not once per attempt.
    if (this.noticesSubject.value.some((notice) => notice.tone === tone && notice.title === title && notice.message === message)) return;

    const notice: ToastNotice = {
      id: this.nextId++,
      tone,
      title,
      message,
      durationMs: Math.max(0, durationMs),
    };

    const next = [...this.noticesSubject.value, notice];
    while (next.length > MAX_VISIBLE) {
      // Make room by dropping the oldest transient notice before any sticky error.
      const transient = next.findIndex((item) => item.durationMs > 0);
      next.splice(transient >= 0 ? transient : 0, 1);
    }
    this.noticesSubject.next(next);
    if (notice.durationMs > 0) window.setTimeout(() => this.dismiss(notice.id), notice.durationMs);
  }
}
