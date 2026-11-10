import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DanaConfirmDialogComponent,
  DanaCountBadgeDirective,
  DanaPageHeaderComponent,
  DanaPanelHeaderDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import {
  FanucVariablesApi,
  LapperAccess,
  loadable,
  MachinesApi,
  ToastService,
} from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
import { Machine, MachineFanucVariable } from '@gearapps/shared/domain';
import { FanucFormDialogComponent } from './fanuc-form-dialog.component';
import { FANUC_SIGNALS } from './options';

interface FanucRow {
  machine: Machine;
  snapshot: MachineFanucVariable | null;
}

@Component({
  selector: 'gear-fanuc-variables-page',
  imports: [
    RouterLink,
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPageHeaderComponent,
    DanaPanelHeaderDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
    FanucFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / CONFIGURATION"
        heading="Fanuc Variables"
        description="The PLC signals each lapper reports: front door, cycle start and in-cycle. They drive the live cell view."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="loading()"
          >
            ↻ {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
      </section>

      <section class="gear-panel data-panel">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div>
            <h2>Machine I/O</h2>
            <p>
              {{ withSnapshot() }} of {{ rows().length }} machines report signals ·
              {{ inCycle() }} in cycle now.
            </p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{ rows().length }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Cell</th>
                @for (s of signals; track s.key) {
                  <th>{{ s.label }} · {{ s.address }}</th>
                }
                <th data-dana-table-static aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.machine.id) {
                <tr>
                  <td class="mono strong nowrap">{{ r.machine.number || r.machine.ip }}</td>
                  <td>
                    @if (r.machine.cell) {
                      <a [routerLink]="['/dashboard/cell', r.machine.cell]"
                        >Cell {{ r.machine.cell }}</a
                      >
                    } @else {
                      —
                    }
                  </td>
                  @for (s of signals; track s.key) {
                    <td>
                      @if (r.snapshot) {
                        <gear-status-badge
                          [tone]="r.snapshot[s.key] ? 'success' : 'neutral'"
                          [text]="r.snapshot[s.key] ? 'ON' : 'OFF'"
                        />
                      } @else {
                        <span class="gear-muted">No signal</span>
                      }
                    </td>
                  }
                  <td class="right">
                    @if (access.canEditSetup()) {
                      <div class="gear-actions">
                        <button
                          type="button"
                          class="gear-btn gear-btn-secondary gear-btn-sm"
                          (click)="openDialog(r)"
                        >
                          {{ r.snapshot ? 'Edit' : 'Set up' }}
                        </button>
                        @if (r.snapshot) {
                          <button
                            type="button"
                            class="gear-btn gear-btn-danger gear-btn-sm"
                            (click)="pendingDelete.set(r)"
                          >
                            Reset
                          </button>
                        }
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="6" class="empty-row">
                    {{ loading() ? 'Loading machines…' : 'No machines configured yet.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <gear-fanuc-form-dialog
      [(open)]="dialogOpen"
      [machine]="editing()?.machine ?? null"
      [snapshot]="editing()?.snapshot ?? null"
      (saved)="onSaved()"
    />
    <dana-confirm-dialog
      [open]="!!pendingDelete()"
      title="Reset Fanuc I/O"
      [message]="
        'Remove the I/O snapshot for ' +
        (pendingDelete()?.machine?.number ?? '') +
        '? The collector creates a new one the next time the machine reports.'
      "
      confirmLabel="Reset"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pendingDelete.set(null)"
    />
  `,
})
export class FanucVariablesPageComponent implements OnInit {
  private readonly api = inject(FanucVariablesApi);
  private readonly machinesApi = inject(MachinesApi);
  private readonly toast = inject(ToastService);
  protected readonly access = inject(LapperAccess);
  protected readonly signals = FANUC_SIGNALS;

  protected readonly machines = loadable<Machine[]>([]);
  protected readonly snapshots = loadable<MachineFanucVariable[]>([]);
  protected readonly loading = computed(() => this.machines.loading() || this.snapshots.loading());
  protected readonly rows = computed<FanucRow[]>(() =>
    [...this.machines.value()]
      .sort((a, b) => (a.number ?? a.ip).localeCompare(b.number ?? b.ip))
      .map((machine) => ({
        machine,
        snapshot: this.snapshots.value().find((s) => s.machine_id === machine.id) ?? null,
      })),
  );
  protected readonly withSnapshot = computed(() => this.rows().filter((r) => r.snapshot).length);
  protected readonly inCycle = computed(
    () => this.rows().filter((r) => r.snapshot?.y03_2_stack_inCycle).length,
  );

  protected dialogOpen = false;
  protected readonly editing = signal<FanucRow | null>(null);
  protected readonly pendingDelete = signal<FanucRow | null>(null);

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    this.machines.load(this.machinesApi.list());
    this.snapshots.load(this.api.list());
  }

  protected openDialog(r: FanucRow) {
    this.editing.set(r);
    this.dialogOpen = true;
  }

  protected onSaved() {
    this.toast.success('Fanuc I/O saved', this.editing()?.machine.number ?? '');
    this.reload();
  }

  protected deleteConfirmed() {
    const r = this.pendingDelete();
    if (!r?.snapshot) return;
    this.pendingDelete.set(null);
    this.api.delete(r.snapshot.id).subscribe({
      next: () => {
        this.toast.success('Fanuc I/O reset', r.machine.number ?? '');
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not reset Fanuc I/O'),
    });
  }
}
