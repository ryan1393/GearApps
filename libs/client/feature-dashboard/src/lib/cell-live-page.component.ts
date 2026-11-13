import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DanaPageHeaderComponent } from '@dana/ui';
import { apiErrorMessage, CollectorApi, CollectorMachine, CollectorStatus, loadable, MachinesApi } from '@meshforge/client/core';
import { EmptyStateComponent } from '@meshforge/client/ui';
import { Machine } from '@meshforge/shared/domain';
import { catchError, exhaustMap, filter, interval, of, startWith } from 'rxjs';
import { groupByCell } from './cells';
import { MachineLiveCardComponent } from './machine-live-card.component';

/** How often the page asks Lapper Read which scanners' photoeyes are on. */
export const PHOTOEYE_POLL_MS = 1_000;

@Component({
  selector: 'gear-cell-live-page',
  imports: [RouterLink, DanaPageHeaderComponent, EmptyStateComponent, MachineLiveCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page dana-page-stack gear-workflow-page">
      <section
        danaPageHeader
        [eyebrow]="focused() ? 'LAPPER · LIVE VIEW · CELL ' + cell() : 'LAPPER · LIVE VIEW'"
        [heading]="focused() ? focused()!.number || focused()!.ip : 'Cell ' + cell()"
        [description]="description()"
      >
        <div danaPageHeaderAction class="dana-toolbar">
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
      </section>

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
        <div class="gear-live-grid" [class.gear-live-grid-one]="focused()">
          @for (m of shown(); track m.id) {
            <gear-machine-live-card
              [machine]="m"
              [pollMs]="pollMs()"
              [photoeye]="photoeyes().has(m.id)"
              [collector]="collectorRows().get(m.id) ?? null"
              [focused]="!!focused()"
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
    const what = 'scanner image, serial numbers and machine I/O';
    return this.focused() ? `One machine of ${n} in this cell · ${what}.` : `${n} machine${n === 1 ? '' : 's'} · ${what}.`;
  });
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
