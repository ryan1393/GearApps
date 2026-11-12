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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DanaPageHeaderComponent } from '@dana/ui';
import { apiErrorMessage, loadable, MachinesApi } from '@meshforge/client/core';
import { EmptyStateComponent } from '@meshforge/client/ui';
import { Machine } from '@meshforge/shared/domain';
import { groupByCell } from './cells';
import { MachineLiveCardComponent } from './machine-live-card.component';

@Component({
  selector: 'gear-cell-live-page',
  imports: [RouterLink, DanaPageHeaderComponent, EmptyStateComponent, MachineLiveCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page gear-workflow-page">
      <section
        danaPageHeader
        eyebrow="LAPPER · LIVE VIEW"
        [heading]="'Cell ' + cell()"
        [description]="
          machines().length +
          ' machine' +
          (machines().length === 1 ? '' : 's') +
          ' · live scanner image, serial numbers and machine I/O.'
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
            <gear-machine-live-card [machine]="m" [pollMs]="pollMs()" />
          }
        </div>
      }
    </div>
  `,
  styles: `
    .gear-live-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr));
      gap: 14px;
    }
    .gear-rates {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
  `,
})
export class CellLivePageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
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

  ngOnInit() {
    this.reload();
  }
  protected reload(): void {
    this.all.load(this.api.list().pipe(takeUntilDestroyed(this.destroy)));
  }
}
