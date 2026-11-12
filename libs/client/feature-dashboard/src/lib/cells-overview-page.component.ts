import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
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
import { LapperProduction, Machine, SETTING_CHANGE_HOURS, SettingChangeCycle, SettingChanges } from '@meshforge/shared/domain';
import { groupByCell } from './cells';

@Component({
  selector: 'gear-cells-overview-page',
  imports: [
    DatePipe,
    DecimalPipe,
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

      <section class="gear-panel data-panel" danaDashboardPanel data-testid="setting-changes">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div>
            <h2>Setting changes · last {{ settingHours }} hours</h2>
            <p>
              @if (settingChanges.error()) {
                Setting changes are unavailable. Refresh to retry.
              } @else {
                Cycles where a value other than the consec counter changed since the previous cycle of
                that machine and gearset.
                @if ((settingChanges.value()?.total ?? 0) > (settingChanges.value()?.items?.length ?? 0)) {
                  Showing the newest {{ settingChanges.value()?.items?.length }} of {{ settingChanges.value()?.total }}.
                }
              }
            </p>
          </div>
          <span
            danaCountBadge
            class="gear-count-badge count-chip"
            [attr.data-tone]="settingChanges.value()?.total ? 'warning' : null"
            >{{ settingChanges.value()?.total ?? 0 }}</span
          >
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table dashboard-table setting-change-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Machine</th>
                <th>Gearset</th>
                <th>Serial</th>
                <th title="Cycle number (consec)">#</th>
                <th>What changed</th>
                <th data-dana-table-static></th>
              </tr>
            </thead>
            <tbody>
              @for (cycle of settingChanges.value()?.items ?? []; track cycle.machine_cycle_id) {
                <tr [attr.data-dana-table-group]="cycle.machine_cycle_id">
                  <td>{{ cycle.timestamp | date: 'MMM d, HH:mm' }}</td>
                  <td class="mono strong">{{ cycle.machine_number || '—' }}</td>
                  <td class="mono">{{ cycle.gearset_number || '—' }}</td>
                  <td class="mono">{{ cycle.serial_number || '—' }}</td>
                  <td>{{ cycle.consec }}</td>
                  <td>
                    <div class="setting-change-summary" [title]="changeNames(cycle)">
                      <gear-status-badge tone="warning" [text]="changeCount(cycle)" />
                      <button
                        type="button"
                        class="gear-btn gear-btn-secondary gear-btn-sm"
                        [attr.aria-expanded]="isExpanded(cycle)"
                        [attr.aria-controls]="'setting-change-' + cycle.machine_cycle_id"
                        (click)="toggleDetails(cycle)"
                      >
                        {{ isExpanded(cycle) ? 'Hide details' : 'Show details' }}
                      </button>
                    </div>
                  </td>
                  <td class="right">
                    <a
                      class="gear-btn gear-btn-secondary gear-btn-sm"
                      routerLink="/lapping-summaries"
                      [queryParams]="{ machine: cycle.machine_id, gearset: cycle.gearset_id }"
                      >Cycle history</a
                    >
                  </td>
                </tr>
                @if (isExpanded(cycle)) {
                  <tr class="setting-change-detail-row" data-dana-table-detail [attr.data-dana-table-group]="cycle.machine_cycle_id">
                    <td colspan="7" class="dana-table-detail-cell" [id]="'setting-change-' + cycle.machine_cycle_id">
                      <ul class="setting-change-grid" [attr.aria-label]="changeCount(cycle) + ' on ' + (cycle.machine_number || 'this machine')">
                        @for (change of cycle.changes; track change.number) {
                          <li>
                            <span class="setting-change-macro gear-muted mono">#{{ change.number }}</span>
                            <span class="setting-change-name">{{ change.name }}</span>
                            <span class="setting-change-values mono"
                              >{{ change.previous_value | number: '1.0-5' }} → <strong>{{ change.value | number: '1.0-5' }}</strong
                              >{{ change.unit ? ' ' + change.unit : '' }}</span
                            >
                            <span class="setting-change-delta mono gear-muted">{{ deltaText(change) }}</span>
                          </li>
                        }
                      </ul>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="7" class="empty-row">
                    {{
                      settingChanges.loading()
                        ? 'Loading setting changes…'
                        : 'No settings changed in the last ' + settingHours + ' hours: only the consec counter moved.'
                    }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
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
  styles: `
    /* The identifying columns stay narrow; each row is one line until its details are opened. */
    .setting-change-table th:nth-child(1) { width: 12%; }
    .setting-change-table th:nth-child(2) { width: 12%; }
    .setting-change-table th:nth-child(3) { width: 10%; }
    .setting-change-table th:nth-child(4) { width: 11%; }
    .setting-change-table th:nth-child(5) { width: 7%; }
    .setting-change-table th:nth-child(6) { width: 32%; }
    .setting-change-table th:nth-child(7) { width: 16%; }
    .setting-change-summary {
      display: flex;
      align-items: center;
      gap: var(--dana-field-gap);
      min-width: 0;
    }
    .setting-change-summary > * { flex: none; }
    .setting-change-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
      gap: var(--dana-field-gap) var(--dana-form-gap);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .setting-change-grid li {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: baseline;
      gap: var(--dana-field-gap);
    }
    .setting-change-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .setting-change-values, .setting-change-delta { white-space: nowrap; }
    /* On a phone the values go under the name, so names are never cut short. */
    @media (max-width: 600px) {
      .setting-change-grid li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--dana-space-1) var(--dana-field-gap); }
      /* The name fills the rest of the first line, so values and difference share the second. */
      .setting-change-name { flex: 1 1 60%; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
    }
  `,
})
export class CellsOverviewPageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  private readonly cyclesApi = inject(MachineCyclesApi);
  protected readonly production = loadable<LapperProduction | null>(null);
  protected readonly settingHours = SETTING_CHANGE_HOURS;
  /** Cycles that changed a setting (anything but the consec counter) recently. */
  protected readonly settingChanges = loadable<SettingChanges | null>(null);
  /** Setting-change cycles whose details are open, by cycle id. */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(cycle: SettingChangeCycle): boolean {
    return this.expanded().has(cycle.machine_cycle_id);
  }

  protected toggleDetails(cycle: SettingChangeCycle): void {
    const next = new Set(this.expanded());
    if (!next.delete(cycle.machine_cycle_id)) next.add(cycle.machine_cycle_id);
    this.expanded.set(next);
  }

  protected changeCount(cycle: SettingChangeCycle): string {
    const n = cycle.changes.length;
    return `${n} ${n === 1 ? 'change' : 'changes'}`;
  }

  /** Every changed value's name, shown on hover. */
  protected changeNames(cycle: SettingChangeCycle): string {
    return cycle.changes.map((change) => change.name || '#' + change.number).join(', ');
  }

  /** How much a value moved: +0.002, -0.004. */
  protected deltaText(change: { previous_value: number; value: number }): string {
    const delta = Math.round((change.value - change.previous_value) * 100000) / 100000;
    return (delta > 0 ? '+' : '') + delta;
  }
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
    this.settingChanges.load(this.cyclesApi.settingChanges(SETTING_CHANGE_HOURS));
  }

  protected scannersIn(machines: Machine[]): number {
    return machines.filter((m) => m.scanner || m.scanner_id).length;
  }
}
