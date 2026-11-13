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
import { RouterLink } from '@angular/router';
import { DanaPageHeaderComponent } from '@dana/ui';
import { apiErrorMessage, CollectorApi, CollectorStatus, loadable, MachinesApi } from '@meshforge/client/core';
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
        eyebrow="LAPPER · LIVE VIEW"
        [heading]="'Cell ' + cell()"
        [description]="
          machines().length +
          ' machine' +
          (machines().length === 1 ? '' : 's') +
          ' · live scanner image, serial numbers and machine I/O. The image refreshes every second while a photoeye is on.'
        "
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <div class="gear-rates" role="group" aria-label="Refresh rate">
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
          <a class="gear-btn gear-btn-secondary" routerLink="/dashboard">‹ All cells</a>
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
        <div class="gear-live-grid">
          @for (m of machines(); track m.id) {
            <gear-machine-live-card [machine]="m" [pollMs]="pollMs()" [photoeye]="photoeyes().has(m.id)" />
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
    .gear-rates {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--dana-space-1);
    }
  `,
})
export class CellLivePageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  private readonly collector = inject(CollectorApi);
  private readonly doc = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);
  readonly cell = input.required<string>();

  protected readonly all = loadable<Machine[]>([]);
  protected readonly errorMessage = computed(() => this.all.error() ? apiErrorMessage(this.all.error()) : '');
  protected readonly machines = computed(
    () => groupByCell(this.all.value()).find((c) => c.id === this.cell())?.machines ?? [],
  );
  protected readonly pollMs = signal(2000);
  protected readonly rates = [
    { label: '1 s', ms: 1000 },
    { label: '2 s', ms: 2000 },
    { label: '5 s', ms: 5000 },
  ];

  /** Machines whose scanner photoeye (input 1) is on, from Lapper Read; empty without the collector. */
  protected readonly photoeyes = signal<ReadonlySet<string>>(new Set());

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
        const on = new Set((status?.machines ?? []).filter((m) => m.photoeye === true).map((m) => m.machine_id));
        const now = this.photoeyes();
        if (on.size !== now.size || [...on].some((id) => !now.has(id))) this.photoeyes.set(on);
      });
  }
  protected reload(): void {
    this.all.load(this.api.list().pipe(takeUntilDestroyed(this.destroy)));
  }
}
