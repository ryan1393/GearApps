import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DanaConfirmDialogComponent, DanaTableDirective } from '@dana/ui';
import {
  DepartmentsApi,
  loadable,
  MachinesApi,
  ScannerDetailsApi,
  ToastService,
} from '@gearapps/client/core';
import { EmptyStateComponent, StatusBadgeComponent } from '@gearapps/client/ui';
import { Machine, ScannerDetail } from '@gearapps/shared/domain';
import { MachineFormDialogComponent } from './machine-form-dialog.component';

@Component({
  selector: 'gear-machines-page',
  imports: [
    DanaTableDirective,
    DanaConfirmDialogComponent,
    StatusBadgeComponent,
    EmptyStateComponent,
    MachineFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-page-header">
      <div>
        <h1>Machines</h1>
        <p>
          Lapping machines, their cells and attached scanners. Click a column to sort; use the
          funnel to filter.
        </p>
      </div>
      <div class="dana-toolbar">
        <button type="button" class="dana-btn" (click)="reload()" [disabled]="machines.loading()">
          {{ machines.loading() ? 'Refreshing…' : 'Refresh' }}
        </button>
        <button type="button" class="dana-btn dana-btn-primary" (click)="openCreate()">
          + Add machine
        </button>
      </div>
    </div>

    <section class="dana-panel">
      <div class="dana-panel-header">
        <div>
          <h2>All machines</h2>
          <small>{{ activeCount() }} active · {{ machines.value().length }} total</small>
        </div>
      </div>
      @if (!machines.loading() && !machines.value().length) {
        <div class="dana-panel-body">
          <gear-empty-state
            title="No machines yet"
            hint="Add the lapping machines on the floor to start tracking cycles and watching cells live."
          >
            <button type="button" class="dana-btn dana-btn-primary" (click)="openCreate()">
              Add the first machine
            </button>
          </gear-empty-state>
        </div>
      } @else {
        <div class="dana-table-shell is-sticky-head">
          <table danaTable class="dana-table">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Cell</th>
                <th>IP</th>
                <th>Description</th>
                <th>Type</th>
                <th>Builder</th>
                <th>Scanner</th>
                <th>Status</th>
                <th data-dana-table-static>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (m of machines.value(); track m.id) {
                <tr [attr.data-tone]="m.status.toLowerCase() === 'active' ? null : 'neutral'">
                  <td>
                    <strong>{{ m.number || '—' }}</strong>
                    @if (m.dept_id) {
                      <span class="dana-cell-sub">Dept {{ m.dept_id }}</span>
                    }
                  </td>
                  <td>{{ m.cell || '—' }}</td>
                  <td>
                    <code>{{ m.ip }}</code>
                  </td>
                  <td>{{ m.description || '—' }}</td>
                  <td>{{ m.type || '—' }}</td>
                  <td>{{ m.builder || '—' }}</td>
                  <td>
                    {{ m.scanner?.ip || m.scanner?.model || (m.scanner_id ? 'Assigned' : '—') }}
                  </td>
                  <td><gear-status-badge [status]="m.status" /></td>
                  <td>
                    <div class="dana-table-actions">
                      <button type="button" class="dana-btn dana-btn-sm" (click)="openEdit(m)">
                        Edit
                      </button>
                      <button
                        type="button"
                        class="dana-btn dana-btn-sm dana-btn-danger"
                        (click)="pendingDelete.set(m)"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <gear-machine-form-dialog
      [(open)]="dialogOpen"
      [machine]="editing()"
      [scannerOptions]="scanners.value()"
      [departmentOptions]="departmentNumbers()"
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

  protected readonly machines = loadable<Machine[]>([]);
  protected readonly scanners = loadable<ScannerDetail[]>([]);
  protected readonly departments = loadable<{ number: number }[]>([]);
  protected readonly departmentNumbers = computed(() =>
    this.departments.value().map((d) => String(d.number)),
  );
  protected readonly activeCount = computed(
    () => this.machines.value().filter((m) => m.status?.toLowerCase() === 'active').length,
  );

  protected dialogOpen = false;
  protected readonly editing = signal<Machine | null>(null);
  protected readonly pendingDelete = signal<Machine | null>(null);

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
