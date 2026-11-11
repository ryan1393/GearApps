import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DanaCountBadgeDirective,
  DanaKpiCardDirective,
  DanaKpiGridDirective,
  DanaOperationCardComponent,
  DanaOperationGridDirective,
  DanaPageHeaderComponent,
  DanaPanelHeaderDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import { apiErrorMessage, LapperAccess, loadable, MachinesApi } from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
import { Machine } from '@gearapps/shared/domain';
import { groupByCell } from './cells';

@Component({
  selector: 'gear-cells-overview-page',
  imports: [
    RouterLink,
    DanaCountBadgeDirective,
    DanaKpiCardDirective,
    DanaKpiGridDirective,
    DanaOperationCardComponent,
    DanaOperationGridDirective,
    DanaPageHeaderComponent,
    DanaPanelHeaderDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page dashboard-page">
      <section
        class="gear-page-header dashboard-heading"
        danaPageHeader
        eyebrow="LAPPER"
        heading="Dashboard"
        description="Welcome back. Here’s what’s happening across the lapping cells."
        [dashboard]="true"
      >
        <button
          danaPageHeaderAction
          type="button"
          class="date-chip refresh-chip"
          (click)="reload()"
          [disabled]="machines.loading()"
        >
          ↻ <span>{{ machines.loading() ? 'Refreshing…' : 'Refresh' }}</span>
        </button>
      </section>

      @if (errorMessage(); as error) {
        <div class="dashboard-alert" role="alert">{{ error }}</div>
      }

      <section danaKpiGrid class="kpi-grid">
        <article danaKpiCard class="kpi-card">
          <div class="kpi-icon blue">
            <span class="gear-glyph gear-glyph-lapping" aria-hidden="true"></span>
          </div>
          <div>
            <strong>{{ cells().length }}</strong>
            <h3>Lapping Cells</h3>
            <p>Cells with machines assigned</p>
          </div>
        </article>
        <article danaKpiCard class="kpi-card">
          <div class="kpi-icon purple">
            <span class="gear-glyph gear-glyph-machine" aria-hidden="true"></span>
          </div>
          <div>
            <strong>{{ machines.value().length }}</strong>
            <h3>Machines</h3>
            <p>Lappers configured</p>
          </div>
        </article>
        <article danaKpiCard class="kpi-card">
          <div class="kpi-icon green">
            <span class="gear-glyph gear-glyph-available" aria-hidden="true"></span>
          </div>
          <div>
            <strong>{{ activeCount() }}</strong>
            <h3>Active</h3>
            <p>Machines in service</p>
          </div>
        </article>
        <article danaKpiCard class="kpi-card">
          <div class="kpi-icon teal">
            <span class="gear-glyph gear-glyph-scanner" aria-hidden="true"></span>
          </div>
          <div>
            <strong>{{ scannerCount() }}</strong>
            <h3>Scanners</h3>
            <p>Attached to machines</p>
          </div>
        </article>
      </section>

      <section class="gear-panel operations-panel">
        <div class="gear-panel-heading panel-heading">
          <h2>Lapper Operations</h2>
          <p>Choose the workflow you need to perform.</p>
        </div>
        <div danaOperationGrid class="operation-grid">
          <a
            routerLink="/lapping-summaries"
            danaOperationCard
            icon="lapping"
            tone="blue"
            heading="Lapping Summaries"
            description="Latest machine parameters run for a gearset on a lapper."
            aria-label="Lapping Summaries"
          ></a>
          @if (access.canEditSetup()) {
            <!-- Shared master data lives in Admin, like the other MeshForge apps. -->
            <a
              routerLink="/admin"
              [queryParams]="{ tab: 'lapping-machines' }"
              danaOperationCard
              icon="machine"
              tone="purple"
              heading="Lapping Machines"
              description="FANUC controllers, cells and scanners of the lappers (Admin)."
              aria-label="Lapping Machines"
            ></a>
            <a
              routerLink="/admin"
              [queryParams]="{ tab: 'gearsets' }"
              danaOperationCard
              icon="gearset"
              tone="green"
              heading="Gearsets"
              description="Pinions and rings paired into gearsets (Admin)."
              aria-label="Gearsets"
            ></a>
            <a
              routerLink="/admin"
              [queryParams]="{ tab: 'part-summaries' }"
              danaOperationCard
              icon="summary"
              tone="orange"
              heading="Part Summaries"
              description="Summary numbers shared by rings, pinions and gearsets (Admin)."
              aria-label="Part Summaries"
            ></a>
          }
        </div>
      </section>

      <section class="gear-panel operations-panel">
        <div class="gear-panel-heading panel-heading">
          <h2>Configuration</h2>
          <p>Scanners, macro variables and machine I/O the lappers report.</p>
        </div>
        <div danaOperationGrid class="operation-grid">
          <a
            routerLink="/scanners"
            danaOperationCard
            icon="scanner"
            tone="teal"
            heading="Scanners"
            description="Scanner addresses, assigned machines and last serial numbers."
            aria-label="Scanners"
          ></a>
          <a
            routerLink="/macros"
            danaOperationCard
            icon="setup"
            tone="purple"
            heading="Macros"
            description="Every Fanuc macro and the summary field that shows it."
            aria-label="Macros"
          ></a>
          <a
            routerLink="/fanuc-variables"
            danaOperationCard
            icon="quality-check"
            tone="gray"
            heading="Fanuc Variables"
            description="Front door, cycle start and in-cycle signals per machine."
            aria-label="Fanuc Variables"
          ></a>
        </div>
      </section>

      <section class="gear-panel data-panel">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div>
            <h2>Lapping Cells</h2>
            <p>Open a cell to watch its machines and scanners live.</p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{ cells().length }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table dashboard-table">
            <thead>
              <tr>
                <th>Cell</th>
                <th>Machines</th>
                <th>Active</th>
                <th>Scanners</th>
                <th data-dana-table-static></th>
              </tr>
            </thead>
            <tbody>
              @for (cell of cells(); track cell.id) {
                <tr>
                  <td class="strong">
                    {{ cell.id === 'Unassigned' ? cell.id : 'Cell ' + cell.id }}
                  </td>
                  <td class="mono">
                    @for (m of cell.machines; track m.id; let last = $last) {
                      {{ m.number || m.ip }}{{ last ? '' : ', ' }}
                    }
                  </td>
                  <td>
                    <gear-status-badge
                      [tone]="
                        cell.active === cell.machines.length
                          ? 'success'
                          : cell.active
                            ? 'warning'
                            : 'danger'
                      "
                      [text]="cell.active + ' / ' + cell.machines.length"
                    />
                  </td>
                  <td>{{ scannersIn(cell.machines) }}</td>
                  <td class="right">
                    <a
                      class="gear-btn gear-btn-secondary gear-btn-sm"
                      [routerLink]="['/dashboard/cell', cell.id]"
                      >Open live view</a
                    >
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="5" class="empty-row">
                    @if (machines.loading()) {
                      Loading cells…
                    } @else {
                      No machines are assigned to a cell yet.
                      @if (access.canEditSetup()) {
                        <a routerLink="/admin" [queryParams]="{ tab: 'lapping-machines' }"
                          >Add a Lapping setup</a
                        >
                        to get started.
                      } @else {
                        An administrator adds them in Admin.
                      }
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class CellsOverviewPageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  protected readonly access = inject(LapperAccess);
  protected readonly machines = loadable<Machine[]>([]);
  protected readonly cells = computed(() => groupByCell(this.machines.value()));
  protected readonly activeCount = computed(
    () => this.machines.value().filter((m) => m.status?.toLowerCase() === 'active').length,
  );
  protected readonly errorMessage = computed(() => {
    const error = this.machines.error();
    return error ? apiErrorMessage(error) : null;
  });
  protected readonly scannerCount = computed(() => this.scannersIn(this.machines.value()));

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    this.machines.load(this.api.list());
  }

  protected scannersIn(machines: Machine[]): number {
    return machines.filter((m) => m.scanner || m.scanner_id).length;
  }
}
