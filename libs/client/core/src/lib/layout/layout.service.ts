import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';

const SCALE_KEY = 'meshforge.textScale';
export const SCALE_MIN = 100;
export const SCALE_MAX = 140;
export const SCALE_STEP = 10;

/** Display preferences that persist per browser. Operators on the floor like bigger text. */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly doc = inject(DOCUMENT);

  /** Root font-size as a percentage of the Dana default (100 = Dana baseline). */
  readonly textScale = signal<number>(load());

  constructor() {
    effect(() => {
      const scale = this.textScale();
      this.doc.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`;
      try {
        localStorage.setItem(SCALE_KEY, String(scale));
      } catch {
        /* storage unavailable */
      }
    });
  }

  bumpScale(direction: 1 | -1) {
    this.textScale.update((s) =>
      Math.min(SCALE_MAX, Math.max(SCALE_MIN, s + direction * SCALE_STEP)),
    );
  }
}

function load(): number {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    return v >= SCALE_MIN && v <= SCALE_MAX ? v : 100;
  } catch {
    return 100;
  }
}
