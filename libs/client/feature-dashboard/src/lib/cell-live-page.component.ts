import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage, CollectorApi, CollectorMachine, CollectorStatus, loadable, MachinesApi } from '@meshforge/client/core';
import { EmptyStateComponent } from '@meshforge/client/ui';
import { Machine } from '@meshforge/shared/domain';
import { catchError, exhaustMap, filter, fromEvent, interval, of, startWith } from 'rxjs';
import { groupByCell } from './cells';
import { MachineLiveCardComponent } from './machine-live-card.component';

/** How often the page asks Lapper Read which scanners' photoeyes are on. */
export const PHOTOEYE_POLL_MS = 1_000;
/**
 * The cell fills the screen, without scrolling, from this width and with at most FIT_MAX_MACHINES
 * machines, when each row of cards gets at least FIT_MIN_ROW_PX. Smaller screens scroll as usual.
 */
export const FIT_MIN_WIDTH_PX = 1024;
export const FIT_MAX_MACHINES = 4;
export const FIT_MIN_ROW_PX = 540;
/** The fewest recent cycles a fitted card shows before the page scrolls instead. */
const MIN_FIT_CYCLES = 2;
/** How long the layout must be still before a fitted card's room is checked. */
const FIT_SETTLE_MS = 250;
/** Space kept under the cards at the bottom of the screen. */
const FIT_BOTTOM_GAP_PX = 16;

@Component({
  selector: 'gear-cell-live-page',
  imports: [RouterLink, EmptyStateComponent, MachineLiveCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page dana-page-stack gear-workflow-page gear-live-page">
      <header class="gear-live-bar">
        <div class="gear-live-title">
          <p class="dana-eyebrow gear-eyebrow">{{ focused() ? 'Lapper · Live view · Cell ' + cell() : 'Lapper · Live view' }}</p>
          <h1 class="dana-page-title gear-page-title">
            {{ focused() ? focused()!.number || focused()!.ip : 'Cell ' + cell() }}
            <small class="gear-muted">{{ description() }}</small>
          </h1>
        </div>
        <div class="dana-toolbar">
          <div class="gear-rates" role="group" aria-label="Refresh rate">
            <span class="gear-muted" aria-hidden="true">Refresh</span>
            @for (r of rates; track r.ms) {
              <button
                type="button"
                class="gear-btn"
                [class.gear-btn-primary]="pollMs() === r.ms"
                [class.gear-btn-secondary]="pollMs() !== r.ms"
                [attr.aria-pressed]="pollMs() === r.ms"
                (click)="pollMs.set(r.ms)"
              >
                {{ r.label }}
              </button>
            }
          </div>
          @if (focused()) {
            <a class="gear-btn gear-btn-secondary" routerLink="." [queryParams]="{ machine: null }" queryParamsHandling="merge"
              >‹ Back to cell {{ cell() }}</a
            >
          } @else {
            <a class="gear-btn gear-btn-secondary" routerLink="/dashboard">‹ All cells</a>
          }
        </div>
      </header>

      @if (all.error()) {
        <div class="gear-alert gear-alert-danger" role="alert">
          {{ errorMessage() }}
          <button type="button" class="gear-btn gear-btn-secondary" (click)="reload()" [disabled]="all.loading()">Retry loading machines</button>
        </div>
      }
      @if (all.loading() && !machines().length) {
        <p class="gear-muted" role="status">Loading machines in cell {{ cell() }}…</p>
      } @else if (!all.error() && !machines().length) {
        <section class="gear-workflow-section">
          <div class="gear-workflow-section-body">
            <gear-empty-state [title]="'No machines in cell ' + cell()">
              <a class="gear-btn gear-btn-primary" routerLink="/dashboard">Back to cells</a>
            </gear-empty-state>
          </div>
        </section>
      } @else {
        <div
          #grid
          class="gear-live-grid"
          [class.gear-live-grid-one]="focused()"
          [style.height.px]="fitHeight()"
          [style.grid-template-columns]="fitHeight() ? 'repeat(' + layout().cols + ', minmax(0, 1fr))' : null"
          [style.grid-template-rows]="fitHeight() ? 'repeat(' + layout().rows + ', minmax(0, 1fr))' : null"
        >
          @for (m of shown(); track m.id) {
            <gear-machine-live-card
              [machine]="m"
              [pollMs]="pollMs()"
              [photoeye]="photoeyes().has(m.id)"
              [collector]="collectorRows().get(m.id) ?? null"
              [focused]="!!focused()"
              [fit]="fitHeight() !== null"
              [recentCount]="recentCount()"
              (focusMachine)="focusOn(m.id)"
            />
          }
        </div>
      }
    </div>
  `,
  styles: `
    .gear-live-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr));
      gap: var(--dana-section-gap);
    }
    /* Cards may shrink below their contents' width; a wide table scrolls inside its card. */
    .gear-live-grid > * {
      min-width: 0;
    }
    /* A monitoring screen: use the full width of large displays, not the usual reading column. */
    .gear-live-page {
      --dana-content-max: none;
    }
    .gear-live-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: var(--dana-space-2) var(--dana-space-4);
    }
    .gear-live-title :is(p, h1) {
      margin: 0;
    }
    .gear-live-grid-one {
      grid-template-columns: 1fr;
    }
    .gear-rates {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--dana-space-1);
    }
  `,
})
export class CellLivePageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  private readonly collector = inject(CollectorApi);
  private readonly doc = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly cell = input.required<string>();
  /** `?machine=<id>`: show only that machine of the cell. An id not in the cell shows the whole cell. */
  readonly machine = input<string | undefined>();

  protected readonly all = loadable<Machine[]>([]);
  protected readonly errorMessage = computed(() => this.all.error() ? apiErrorMessage(this.all.error()) : '');
  protected readonly machines = computed(
    () => groupByCell(this.all.value()).find((c) => c.id === this.cell())?.machines ?? [],
  );
  protected readonly focused = computed(() => {
    const id = this.machine();
    return id ? (this.machines().find((m) => m.id === id) ?? null) : null;
  });
  protected readonly shown = computed(() => {
    const one = this.focused();
    return one ? [one] : this.machines();
  });
  protected readonly description = computed(() => {
    const n = this.machines().length;
    return this.focused() ? `· 1 of ${n} machines in cell ${this.cell()}` : `· ${n} machine${n === 1 ? '' : 's'}`;
  });
  /** Cards per row and rows of cards when the cell fills the screen. */
  protected readonly layout = computed(() => {
    const n = this.shown().length;
    const cols = n <= 1 ? 1 : 2;
    return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
  });
  /** Recent cycles per card: more when focused, fewer when rows of cards are short. */
  protected readonly recentCount = computed(() => {
    const height = this.fitHeight();
    const rowHeight = height === null ? null : height / this.layout().rows;
    const wanted = this.focused() ? (rowHeight !== null && rowHeight < 700 ? 5 : 8) : rowHeight !== null && rowHeight < 640 ? 3 : 5;
    return Math.min(wanted, this.cycleCap());
  });
  /** Lowered while fitting when the cards' data would not fit beside the cycles. */
  private readonly cycleCap = signal(Number.POSITIVE_INFINITY);
  /** The grid's height in px when it fills the rest of the screen; null scrolls as usual. */
  protected readonly fitHeight = signal<number | null>(null);
  private readonly grid = viewChild<ElementRef<HTMLElement>>('grid');
  private readonly view = this.doc.defaultView;
  private settleTimer?: ReturnType<typeof setTimeout>;
  protected readonly pollMs = signal(2000);
  protected readonly rates = [
    { label: '1 s', ms: 1000 },
    { label: '2 s', ms: 2000 },
    { label: '5 s', ms: 5000 },
  ];

  /** Machines whose scanner photoeye (input 1) is on, from Lapper Read; empty without the collector. */
  protected readonly photoeyes = signal<ReadonlySet<string>>(new Set());
  /** Lapper Read's row per machine (scanner inputs and outputs); empty without the collector. */
  protected readonly collectorRows = signal<ReadonlyMap<string, CollectorMachine>>(new Map());

  constructor() {
    afterNextRender(() => this.fit());
    // Re-measure after the cards or the header change (machines loaded, focus on or off).
    effect(() => {
      this.shown();
      this.focused();
      this.grid();
      this.view?.requestAnimationFrame(() => this.fit());
    });
    this.destroy.onDestroy(() => clearTimeout(this.settleTimer));
    if (this.view) {
      fromEvent(this.view, 'resize')
        .pipe(takeUntilDestroyed(this.destroy))
        .subscribe(() => this.fit());
    }
  }

  /** Sizes the grid to the space left under the page header, so the whole cell shows without scrolling. */
  protected fit(): void {
    const el = this.grid()?.nativeElement;
    const view = this.view;
    const n = this.shown().length;
    this.cycleCap.set(Number.POSITIVE_INFINITY);
    if (!el || !view || !n || n > FIT_MAX_MACHINES || view.innerWidth < FIT_MIN_WIDTH_PX) {
      this.fitHeight.set(null);
      return;
    }
    const top = el.getBoundingClientRect().top + view.scrollY;
    const height = Math.floor(view.innerHeight - top - FIT_BOTTOM_GAP_PX);
    if (height < this.layout().rows * FIT_MIN_ROW_PX) {
      this.fitHeight.set(null);
      return;
    }
    this.fitHeight.set(height);
    // The app shell may add padding below the page: take off whatever still makes it scroll.
    view.requestAnimationFrame(() => {
      const over = this.doc.documentElement.scrollHeight - view.innerHeight;
      const now = this.fitHeight();
      if (over > 0 && now !== null) this.fitHeight.set(now - over);
      this.checkRoom();
    });
  }

  /** Checks the fitted cards once the layout has been still for FIT_SETTLE_MS (see makeRoom). */
  private checkRoom(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.makeRoom(), FIT_SETTLE_MS);
  }

  /**
   * Nothing may be cut off: when a card's data does not fit, show as many fewer recent cycles as
   * the overflow needs (down to MIN_FIT_CYCLES); if that is still not enough, let the page scroll.
   */
  private makeRoom(): void {
    const grid = this.grid()?.nativeElement;
    if (!grid || this.fitHeight() === null) return;
    const over = Math.max(0, ...Array.from(grid.querySelectorAll<HTMLElement>('.gear-live-data')).map((d) => d.scrollHeight - d.clientHeight));
    if (over <= 1) return;
    const rowPx = grid.querySelector('.gear-live-cycles tbody tr')?.getBoundingClientRect().height || 28;
    const next = this.recentCount() - Math.ceil(over / rowPx);
    if (next >= MIN_FIT_CYCLES) this.cycleCap.set(next);
    else this.fitHeight.set(null);
  }

  ngOnInit() {
    this.reload();
    interval(PHOTOEYE_POLL_MS)
      .pipe(
        startWith(0),
        filter(() => this.doc.visibilityState === 'visible'),
        exhaustMap(() => this.collector.status().pipe(catchError(() => of(null as CollectorStatus | null)))),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((status) => {
        // Cards change size as data arrives: check again that nothing is cut off.
        this.checkRoom();
        this.collectorRows.set(new Map((status?.machines ?? []).map((m) => [m.machine_id, m])));
        const on = new Set((status?.machines ?? []).filter((m) => m.photoeye === true).map((m) => m.machine_id));
        const now = this.photoeyes();
        if (on.size !== now.size || [...on].some((id) => !now.has(id))) this.photoeyes.set(on);
      });
  }
  /** Shows only this machine; the choice is kept in the address so it can be bookmarked. */
  protected focusOn(machineId: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { machine: machineId }, queryParamsHandling: 'merge' });
  }

  protected reload(): void {
    this.all.load(this.api.list().pipe(takeUntilDestroyed(this.destroy)));
  }
}
