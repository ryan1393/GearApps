import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { loadable, MachinesApi } from '@gearapps/client/core';
import { EmptyStateComponent } from '@gearapps/client/ui';
import { Machine } from '@gearapps/shared/domain';
import { groupByCell } from './cells';
import { MachineLiveCardComponent } from './machine-live-card.component';

@Component({
  selector: 'gear-cell-live-page',
  imports: [RouterLink, EmptyStateComponent, MachineLiveCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-page-header">
      <div>
        <h1>Cell {{ cell() }}</h1>
        <p>
          {{ machines().length }} machine{{ machines().length === 1 ? '' : 's' }} · live scanner
          image, serial numbers and machine I/O.
        </p>
      </div>
      <div class="dana-toolbar">
        <div class="dana-segmented gear-rates" role="group" aria-label="Refresh rate">
          @for (r of rates; track r.ms) {
            <button
              type="button"
              [attr.aria-pressed]="pollMs() === r.ms"
              (click)="pollMs.set(r.ms)"
            >
              {{ r.label }}
            </button>
          }
        </div>
        <a class="dana-btn" routerLink="/dashboard">‹ All cells</a>
      </div>
    </div>

    @if (!all.loading() && !machines().length) {
      <section class="dana-panel">
        <div class="dana-panel-body">
          <gear-empty-state [title]="'No machines in cell ' + cell()"
            ><a class="dana-btn dana-btn-primary" routerLink="/dashboard"
              >Back to cells</a
            ></gear-empty-state
          >
        </div>
      </section>
    } @else {
      <div class="gear-live-grid">
        @for (m of machines(); track m.id) {
          <gear-machine-live-card [machine]="m" [pollMs]="pollMs()" />
        }
      </div>
    }
  `,
  styles: `
    .gear-live-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr));
      gap: 14px;
    }
    .gear-rates {
      min-width: 180px;
    }
    .gear-rates > button {
      min-height: 40px;
    }
  `,
})
export class CellLivePageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  readonly cell = input.required<string>();

  protected readonly all = loadable<Machine[]>([]);
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
    this.all.load(this.api.list());
  }
}
