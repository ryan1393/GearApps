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
import { DanaPageHeaderComponent } from '@dana/ui';
import { loadable, MachinesApi } from '@meshforge/client/core';
import { EmptyStateComponent } from '@meshforge/client/ui';
import { Machine } from '@meshforge/shared/domain';
import { groupByCell } from './cells';
import { MachineLiveCardComponent } from './machine-live-card.component';

@Component({
  selector: 'gear-cell-live-page',
  imports: [RouterLink, DanaPageHeaderComponent, EmptyStateComponent, MachineLiveCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page">
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

      @if (!all.loading() && !machines().length) {
        <section class="gear-panel">
          <div class="lapper-panel-body">
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
      gap: 4px;
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
