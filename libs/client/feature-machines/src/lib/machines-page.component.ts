import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
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
  DepartmentsApi,
  loadable,
  MachinesApi,
  ScannerDetailsApi,
  ToastService,
  LapperAccess,
} from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
import { Department, Machine, ScannerDetail } from '@gearapps/shared/domain';
import { MachineFormDialogComponent } from './machine-form-dialog.component';

@Component({
  selector: 'gear-machines-page',
  imports: [
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPageHeaderComponent,
    DanaPanelHeaderDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
    MachineFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / REFERENCE"
        heading="Machines"
        description="Lapping machines, the cells they run in and the scanners attached to them."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="machines.loading()"
          >
            ↻ {{ machines.loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          @if (access.canEditSetup()) {
            <button type="button" class="gear-btn gear-btn-primary" (click)="openCreate()">
              + Add machine
            </button>
          }
        </div>
      </section>

      <section class="gear-panel data-panel">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div>
            <h2>All Machines</h2>
            <p>{{ activeCount() }} active · sort by any column or filter with the funnel.</p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{
            machines.value().length
          }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Cell</th>
                <th>Dept</th>
                <th title="FANUC controller IP">IP</th>
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
                    @if (access.canEditSetup()) {
                      <div class="gear-actions">
                        <button
                          type="button"
                          class="gear-btn gear-btn-secondary gear-btn-sm"
                          (click)="openEdit(m)"
                          [attr.aria-label]="'Edit ' + (m.number || m.ip)"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="gear-btn gear-btn-danger gear-btn-sm"
                          (click)="pendingDelete.set(m)"
                          [attr.aria-label]="'Delete ' + (m.number || m.ip)"
                        >
                          Delete
                        </button>
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="8" class="empty-row">
                    @if (machines.loading()) {
                      Loading machines…
                    } @else {
                      No machines yet. Add the lappers on the floor to start tracking cycles and
                      watching cells live.
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <gear-machine-form-dialog
      [(open)]="dialogOpen"
      [machine]="editing()"
      [scannerOptions]="scanners.value()"
      [departmentOptions]="departmentOptions()"
      (saved)="onSaved($event)"
    />

    <dana-confirm-dialog
      [open]="!!pendingDelete()"
      title="Delete machine"
      [message]="
        'Delete ' +
        (pendingDelete()?.number || pendingDelete()?.ip) +
        '? Cycle history that references it will be affected.'
      "
      confirmLabel="Delete"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pendingDelete.set(null)"
    />
  `,
})
export class MachinesPageComponent implements OnInit {
  private readonly api = inject(MachinesApi);
  private readonly scannersApi = inject(ScannerDetailsApi);
  private readonly departmentsApi = inject(DepartmentsApi);
  private readonly toast = inject(ToastService);
  protected readonly access = inject(LapperAccess);

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

  protected dialogOpen = false;
  protected readonly editing = signal<Machine | null>(null);
  protected readonly pendingDelete = signal<Machine | null>(null);

  protected machineModel(m: Machine): string {
    return [m.builder, m.type].filter(Boolean).join(' ') || '—';
  }

  protected departmentLabel(code: string | null | undefined): string {
    if (!code) return '—';
    const match = this.departmentOptions().find((d) => d.value === String(code));
    return match?.label ?? code;
  }

  ngOnInit() {
    this.reload();
    this.scanners.load(this.scannersApi.list());
    this.departments.load(this.departmentsApi.list());
  }

  protected reload() {
    this.machines.load(this.api.list());
  }

  protected openCreate() {
    this.editing.set(null);
    this.dialogOpen = true;
  }

  protected openEdit(m: Machine) {
    this.editing.set(m);
    this.dialogOpen = true;
  }

  protected onSaved(m: Machine) {
    this.toast.success(this.editing() ? 'Machine updated' : 'Machine added', m.number ?? m.ip);
    this.reload();
  }

  protected deleteConfirmed() {
    const m = this.pendingDelete();
    if (!m) return;
    this.pendingDelete.set(null);
    this.api.delete(m.id).subscribe({
      next: () => {
        this.toast.success('Machine deleted', m.number ?? m.ip);
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not delete machine'),
    });
  }
}
