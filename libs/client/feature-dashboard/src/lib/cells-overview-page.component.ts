import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DanaCountBadgeDirective,
  DanaDashboardPanelComponent,
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
import { apiErrorMessage, LapperAccess, loadable, MachinesApi, MachineCyclesApi } from '@meshforge/client/core';
import { StatusBadgeComponent } from '@meshforge/client/ui';
import { LapperProduction, Machine } from '@meshforge/shared/domain';
import { groupByCell } from './cells';

@Component({
  selector: 'gear-cells-overview-page',
  imports: [
    DatePipe,
    RouterLink,
    DanaCountBadgeDirective,
    DanaDashboardPanelComponent,
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
        description="Production over the past 24 hours, machine by machine. Open a cell for live status or a machine for its cycle history."
        [dashboard]="true"
      >
        <button
          danaPageHeaderAction
          type="button"
          class="date-chip refresh-chip"
          (click)="reload()"
          [disabled]="machines.loading()"
         data-icon="refresh" title="Refresh">
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
            <strong>{{ production.value()?.cycles_24h ?? '—' }}</strong>
            <h3>Cycles · 24 hours</h3>
            <p>Recorded production cycles</p>
          </div>
        </article>
        <article danaKpiCard class="kpi-card">
          <div class="kpi-icon purple">
            <span class="gear-glyph gear-glyph-machine" aria-hidden="true"></span>
          </div>
          <div>
            <strong>{{ production.value()?.machines_reporting_24h ?? '—' }}</strong>
            <h3>Reporting machines</h3>
            <p>Produced in the past 24 hours</p>
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
            <strong>{{ production.value()?.missing_serial_24h ?? '—' }}</strong>
            <h3>Missing serials</h3>
            <p>Cycles needing traceability review</p>
          </div>
        </article>
      </section>

      <section class="gear-panel operations-panel" danaDashboardPanel>
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
            <a
              routerLink="/admin"
              [queryParams]="{ tab: 'macros' }"
              danaOperationCard
              icon="lapping"
              tone="teal"
              heading="Macros and Limits"
              description="The variables each cycle records and their acceptable ranges (Admin)."
              aria-label="Macros and Limits"
            ></a>
            <a
              routerLink="/admin"
              [queryParams]="{ tab: 'cycle-tests' }"
              danaOperationCard
              icon="scanner"
              tone="green"
              heading="Cycle Test Lab"
              description="Try a cycle with a serial number without touching production (Admin)."
              aria-label="Cycle Test Lab"
            ></a>
          }
        </div>
      </section>

      <section class="gear-panel data-panel" danaDashboardPanel aria-live="polite">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div>
            <h2>Production by Machine</h2>
            <p>
              @if (production.error()) {
                Production totals are unavailable. Refresh to retry.
              } @else if (production.value()?.last_cycle_at) {
                Last recorded cycle {{ production.value()?.last_cycle_at | date: 'medium' }}.
              } @else {
                No production recorded yet.
              }
            </p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{ machineRows().length }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table dashboard-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Cell</th>
                <th>Last hour</th>
                <th>24 hours</th>
                <th>Missing serials</th>
                <th>Last cycle</th>
                <th>Last gearset</th>
                <th data-dana-table-static></th>
              </tr>
            </thead>
            <tbody>
              @for (row of machineRows(); track row.machine_id) {
                <tr>
                  <td class="mono strong">{{ row.number }}</td>
                  <td>{{ row.cell || '—' }}</td>
                  <td>{{ row.cycles_1h }}</td>
                  <td class="strong">{{ row.cycles_24h }}</td>
                  <td>
                    @if (row.missing_serial_24h) {
                      <gear-status-badge tone="warning" [text]="row.missing_serial_24h + ' missing'" />
                    } @else {
                      0
                    }
                  </td>
                  <td>
                    @if (row.last_cycle_at) {
                      {{ row.last_cycle_at | date: 'MMM d, HH:mm' }}
                    } @else {
                      <gear-status-badge [tone]="isActive(row.status) ? 'warning' : 'neutral'" [text]="isActive(row.status) ? 'No cycles yet' : 'Inactive'" />
                    }
                  </td>
                  <td class="mono">
                    {{ row.last_gearset || '—' }}
                    @if (row.last_serial_number) {
                      <small class="gear-muted">· {{ row.last_serial_number }}</small>
                    }
                  </td>
                  <td class="right">
                    @if (row.last_gearset_id) {
                      <a
                        class="gear-btn gear-btn-secondary gear-btn-sm"
                        routerLink="/lapping-summaries"
                        [queryParams]="{ machine: row.machine_id, gearset: row.last_gearset_id }"
                        >Cycle history</a
                      >
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="8" class="empty-row">
                    {{ production.loading() ? 'Loading production…' : 'No lapping machines are set up yet.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="gear-panel data-panel" danaDashboardPanel>
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
  private readonly cyclesApi = inject(MachineCyclesApi);
  protected readonly production = loadable<LapperProduction | null>(null);
  protected readonly access = inject(LapperAccess);
  protected readonly machines = loadable<Machine[]>([]);
  protected readonly cells = computed(() => groupByCell(this.machines.value()));
  protected readonly machineRows = computed(() => this.production.value()?.machines ?? []);
  protected readonly isActive = (status: string) => status?.toLowerCase() === 'active';
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
    this.production.load(this.cyclesApi.production());
  }

  protected scannersIn(machines: Machine[]): number {
    return machines.filter((m) => m.scanner || m.scanner_id).length;
  }
}
