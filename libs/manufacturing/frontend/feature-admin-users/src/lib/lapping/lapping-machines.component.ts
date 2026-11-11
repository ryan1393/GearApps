import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import {
  DanaConfirmDialogComponent,
  DanaCountBadgeDirective,
  DanaPanelHeaderDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import {
  DepartmentsApi,
  loadable,
  MachinesApi,
  ScannerDetailsApi,
  ToastService,
} from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
import { Department, Machine, ScannerDetail } from '@gearapps/shared/domain';
import { MachineRow } from '../admin-api.service';
import { MachineFormDialogComponent } from './machine-form-dialog.component';

/**
 * The Lapping setup of shared machines: FANUC controller IP, lapper type and builder, scanner and
 * collection status. The machine itself (number, department, cell, description, enabled) is the
 * shared record in the Machines tab; removing a Lapping setup leaves that record untouched.
 */
@Component({
  selector: 'gear-admin-lapping-machines',
  imports: [
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPanelHeaderDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
    MachineFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="gear-panel data-panel">
      <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
        <div>
          <h2>Lapping Machines</h2>
          <p>
            {{ activeCount() }} active · Lapper Read collects from active machines that have a FANUC
            IP; without an online scanner their cycles are recorded without a serial.
          </p>
        </div>
        <div class="dana-toolbar">
          <span danaCountBadge class="gear-count-badge count-chip">{{ machines.value().length }}</span>
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="machines.loading()"
           data-icon="refresh" title="Refresh">
            ↻ {{ machines.loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button type="button" class="gear-btn gear-btn-primary" (click)="open(null)">
            + Add Lapping setup
          </button>
        </div>
      </div>
      <div danaTableShell class="table-wrap">
        <table danaTable class="gear-table">
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Cell</th>
              <th>Dept</th>
              <th title="FANUC controller IP">FANUC IP</th>
              <th>Machine</th>
              <th>Scanner</th>
              <th>Status</th>
              <th data-dana-table-static aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            @for (m of machines.value(); track m.id) {
              <tr>
                <td class="mono strong" [title]="m.description || ''">{{ m.number || '—' }}</td>
                <td>{{ m.cell || '—' }}</td>
                <td [title]="departmentLabel(m.dept_id)">{{ m.dept_id || '—' }}</td>
                <td class="mono nowrap">{{ m.ip }}</td>
                <td>{{ machineModel(m) }}</td>
                <td class="mono nowrap">
                  {{ m.scanner?.ip || m.scanner?.model || (m.scanner_id ? 'Assigned' : '—') }}
                </td>
                <td><gear-status-badge [status]="m.status" /></td>
                <td class="right">
                  <div class="gear-actions">
                    <button
                      type="button"
                      class="gear-btn gear-btn-secondary gear-btn-sm"
                      (click)="open(m)"
                      [attr.aria-label]="'Edit Lapping setup for ' + (m.number || m.ip)"
                     data-icon="edit" title="Edit">
                      Edit
                    </button>
                    <button
                      type="button"
                      class="gear-btn gear-btn-danger gear-btn-sm"
                      (click)="pendingRemove.set(m)"
                      [attr.aria-label]="'Remove Lapping setup for ' + (m.number || m.ip)"
                     data-icon="delete" title="Remove">
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td danaTableEmpty colspan="8" class="empty-row">
                  @if (machines.loading()) {
                    Loading Lapping machines…
                  } @else {
                    No machine has a Lapping setup yet. Add one for each lapper on the floor.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <gear-machine-form-dialog
      [(open)]="dialogOpen"
      [machine]="editing()"
      [scannerOptions]="scanners.value()"
      [departmentOptions]="departmentOptions()"
      [machineNumberOptions]="unconfiguredNumbers()"
      (saved)="onSaved($event)"
    />
    <dana-confirm-dialog
      [open]="!!pendingRemove()"
      title="Remove Lapping setup"
      [message]="
        'Remove the Lapping setup for ' +
        (pendingRemove()?.number || pendingRemove()?.ip) +
        '? Lapper Read stops collecting from it. The shared machine and its cycle history are kept.'
      "
      confirmLabel="Remove"
      [danger]="true"
      (confirm)="removeConfirmed()"
      (cancel)="pendingRemove.set(null)"
    />
  `,
})
export class LappingMachinesComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  private readonly scannersApi = inject(ScannerDetailsApi);
  private readonly departmentsApi = inject(DepartmentsApi);
  private readonly toast = inject(ToastService);

  /** Shared machines from the Admin Machines tab, used to suggest numbers without a setup. */
  readonly sharedMachines = input<MachineRow[]>([]);

  protected readonly machines = loadable<Machine[]>([]);
  protected readonly scanners = loadable<ScannerDetail[]>([]);
  protected readonly departments = loadable<Department[]>([]);
  protected readonly departmentOptions = computed(() =>
    this.departments.value().map((d) => ({
      value: String(d.number),
      label: d.description ? `${d.number} · ${d.description}` : String(d.number),
    })),
  );
  protected readonly activeCount = computed(
    () => this.machines.value().filter((m) => m.status?.toLowerCase() === 'active').length,
  );
  protected readonly unconfiguredNumbers = computed(() => {
    const configured = new Set(this.machines.value().map((m) => (m.number ?? '').toUpperCase()));
    return this.sharedMachines()
      .filter((m) => m.enabled && m.machine_type === 'PRODUCTION')
      .map((m) => m.machine_number)
      .filter((number) => !configured.has(number.toUpperCase()))
      .sort((a, b) => a.localeCompare(b));
  });

  protected dialogOpen = false;
  protected readonly editing = signal<Machine | null>(null);
  protected readonly pendingRemove = signal<Machine | null>(null);

  ngOnInit() {
    this.reload();
    this.scanners.load(this.scannersApi.list());
    this.departments.load(this.departmentsApi.list());
  }

  protected reload() {
    this.machines.load(this.api.list());
  }

  protected machineModel(m: Machine): string {
    return [m.builder, m.type].filter(Boolean).join(' ') || '—';
  }

  protected departmentLabel(code: string | null | undefined): string {
    if (!code) return '—';
    const match = this.departmentOptions().find((d) => d.value === String(code));
    return match?.label ?? code;
  }

  protected open(m: Machine | null) {
    this.editing.set(m);
    this.dialogOpen = true;
  }

  protected onSaved(m: Machine) {
    this.toast.success(
      this.editing() ? 'Lapping setup updated' : 'Lapping setup added',
      m.number ?? m.ip,
    );
    this.reload();
  }

  protected removeConfirmed() {
    const m = this.pendingRemove();
    if (!m) return;
    this.pendingRemove.set(null);
    this.api.delete(m.id).subscribe({
      next: () => {
        this.toast.success('Lapping setup removed', m.number ?? m.ip);
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not remove Lapping setup'),
    });
  }
}
