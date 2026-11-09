import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { loadable, MachinesApi } from '@gearapps/client/core';
import { EmptyStateComponent } from '@gearapps/client/ui';
import { Machine } from '@gearapps/shared/domain';
import { groupByCell } from './cells';

@Component({
  selector: 'gear-cells-overview-page',
  imports: [RouterLink, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-page-header">
      <div>
        <h1>Lapping cells</h1>
        <p>Pick a cell to watch its machines and scanners live.</p>
      </div>
      <div class="dana-toolbar">
        <button type="button" class="dana-btn" (click)="reload()">Refresh</button>
      </div>
    </div>

    <div class="dana-kpi-grid">
      <div class="dana-kpi-card">
        <div class="dana-kpi-label">Cells</div>
        <div class="dana-kpi-value">{{ cells().length }}</div>
        <div class="dana-kpi-note">with machines assigned</div>
      </div>
      <div class="dana-kpi-card">
        <div class="dana-kpi-label">Machines</div>
        <div class="dana-kpi-value">{{ machines.value().length }}</div>
        <div class="dana-kpi-note">lappers configured</div>
      </div>
      <div class="dana-kpi-card" [attr.data-tone]="activeCount() ? 'success' : null">
        <div class="dana-kpi-label">Active</div>
        <div class="dana-kpi-value">{{ activeCount() }}</div>
        <div class="dana-kpi-note">status Active</div>
      </div>
      <div class="dana-kpi-card">
        <div class="dana-kpi-label">Scanners</div>
        <div class="dana-kpi-value">{{ scannerCount() }}</div>
        <div class="dana-kpi-note">attached to machines</div>
      </div>
    </div>

    @if (!machines.loading() && !cells().length) {
      <section class="dana-panel">
        <div class="dana-panel-body">
          <gear-empty-state
            title="No machines configured"
            hint="Add machines and assign them to cells to see them here."
          >
            <a class="dana-btn dana-btn-primary" routerLink="/machines">Go to machines</a>
          </gear-empty-state>
        </div>
      </section>
    } @else {
      <div class="gear-cell-grid">
        @for (cell of cells(); track cell.id) {
          <a
            class="dana-card gear-cell"
            [routerLink]="['/dashboard/cell', cell.id]"
            [attr.data-tone]="cell.active ? 'success' : null"
          >
            <div class="dana-card-header">
              <div>
                <span class="dana-card-eyebrow">Cell</span
                ><span class="dana-card-title">{{ cell.id }}</span>
              </div>
              <span class="dana-count-badge" [attr.data-tone]="cell.active ? 'success' : null"
                >{{ cell.active }}/{{ cell.machines.length }} active</span
              >
            </div>
            <ul class="dana-chip-list">
              @for (m of cell.machines; track m.id) {
                <li
                  class="dana-chip"
                  [attr.data-tone]="m.status.toLowerCase() === 'active' ? 'info' : null"
                  [title]="m.description || m.ip"
                >
                  {{ m.number || m.ip }}
                  @if (m.scanner) {
                    <span aria-label="Scanner attached"> ·📷</span>
                  }
                </li>
              }
            </ul>
            <div class="gear-cell-foot">Open live view ›</div>
          </a>
        }
      </div>
    }
  `,
  styles: `
    .gear-cell-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
    }
    .gear-cell {
      text-decoration: none;
      transition:
        border-color 0.15s,
        transform 0.15s;
    }
    .gear-cell:hover {
      border-color: #c7d3e1;
      transform: translateY(-1px);
    }
    .gear-cell-foot {
      margin-top: auto;
      color: var(--dana-primary);
      font-size: 13px;
      font-weight: 700;
    }
  `,
})
export class CellsOverviewPageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  protected readonly machines = loadable<Machine[]>([]);
  protected readonly cells = computed(() => groupByCell(this.machines.value()));
  protected readonly activeCount = computed(
    () => this.machines.value().filter((m) => m.status?.toLowerCase() === 'active').length,
  );
  protected readonly scannerCount = computed(
    () => this.machines.value().filter((m) => m.scanner || m.scanner_id).length,
  );

  ngOnInit() {
    this.reload();
  }
  protected reload() {
    this.machines.load(this.api.list());
  }
}
