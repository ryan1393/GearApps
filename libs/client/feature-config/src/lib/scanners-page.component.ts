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
  LapperAccess,
  loadable,
  MachinesApi,
  ScannerDetailsApi,
  ToastService,
} from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
import { Machine, ScannerDetail } from '@gearapps/shared/domain';
import { ScannerFormDialogComponent } from './scanner-form-dialog.component';

@Component({
  selector: 'gear-scanners-page',
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
    ScannerFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / CONFIGURATION"
        heading="Scanners"
        description="Barcode scanners on the lapping cells, the machine each one reads for and the serial numbers it last reported."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="scanners.loading()"
          >
            ↻ {{ scanners.loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          @if (access.canEditSetup()) {
            <button type="button" class="gear-btn gear-btn-primary" (click)="openDialog(null)">
              + Add scanner
            </button>
          }
        </div>
      </section>

      <section class="gear-panel data-panel">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div>
            <h2>All Scanners</h2>
            <p>{{ assignedCount() }} assigned to a machine · {{ activeCount() }} active.</p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{
            scanners.value().length
          }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table">
            <thead>
              <tr>
                <th>IP</th>
                <th>Model</th>
                <th>Machine</th>
                <th>Scanner · queue · process</th>
                <th>Status</th>
                <th data-dana-table-static aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (s of scanners.value(); track s.id) {
                <tr>
                  <td class="mono strong nowrap" [title]="s.description || ''">
                    {{ s.ip || '—' }}
                  </td>
                  <td class="nowrap">{{ modelLabel(s) }}</td>
                  <td class="mono nowrap">
                    @if (machineFor(s); as m) {
                      <a [routerLink]="['/dashboard/cell', m.cell || 'Unassigned']">{{
                        m.number || m.ip
                      }}</a>
                    } @else {
                      <span class="gear-muted">Not assigned</span>
                    }
                  </td>
                  <td class="mono nowrap" title="In scanner · in queue · in process">
                    {{ s.sn_scanner || '—' }} · {{ s.sn_queue || '—' }} · {{ s.sn_procces || '—' }}
                  </td>
                  <td><gear-status-badge [status]="s.status" /></td>
                  <td class="right">
                    @if (access.canEditSetup()) {
                      <div class="gear-actions">
                        <button
                          type="button"
                          class="gear-btn gear-btn-secondary gear-btn-sm"
                          (click)="openDialog(s)"
                          [attr.aria-label]="'Edit scanner ' + s.ip"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="gear-btn gear-btn-danger gear-btn-sm"
                          (click)="pendingDelete.set(s)"
                          [attr.aria-label]="'Delete scanner ' + s.ip"
                        >
                          Delete
                        </button>
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="6" class="empty-row">
                    {{ scanners.loading() ? 'Loading scanners…' : 'No scanners yet.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <gear-scanner-form-dialog
      [(open)]="dialogOpen"
      [scanner]="editing()"
      [machines]="machines.value()"
      [scanners]="scanners.value()"
      (saved)="onSaved($event)"
    />
    <dana-confirm-dialog
      [open]="!!pendingDelete()"
      title="Delete scanner"
      [message]="
        'Delete scanner ' +
        (pendingDelete()?.ip ?? '') +
        '? The machine it reads for will have no scanner.'
      "
      confirmLabel="Delete"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pendingDelete.set(null)"
    />
  `,
})
export class ScannersPageComponent implements OnInit {
  private readonly api = inject(ScannerDetailsApi);
  private readonly machinesApi = inject(MachinesApi);
  private readonly toast = inject(ToastService);
  protected readonly access = inject(LapperAccess);

  protected readonly scanners = loadable<ScannerDetail[]>([]);
  protected readonly machines = loadable<Machine[]>([]);
  protected readonly assignedCount = computed(
    () => this.scanners.value().filter((s) => s.machine_id).length,
  );
  protected readonly activeCount = computed(
    () => this.scanners.value().filter((s) => s.status?.toLowerCase() === 'active').length,
  );

  protected dialogOpen = false;
  protected readonly editing = signal<ScannerDetail | null>(null);
  protected readonly pendingDelete = signal<ScannerDetail | null>(null);

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    this.scanners.load(this.api.list());
    this.machines.load(this.machinesApi.list());
  }

  protected modelLabel(s: ScannerDetail): string {
    return [s.model, s.type].filter(Boolean).join(' · ') || '—';
  }

  protected machineFor(s: ScannerDetail): Machine | null {
    return s.machine ?? this.machines.value().find((m) => m.id === s.machine_id) ?? null;
  }

  protected openDialog(s: ScannerDetail | null) {
    this.editing.set(s);
    this.dialogOpen = true;
  }

  protected onSaved(s: ScannerDetail) {
    this.toast.success(this.editing() ? 'Scanner updated' : 'Scanner added', s.ip ?? '');
    this.reload();
  }

  protected deleteConfirmed() {
    const s = this.pendingDelete();
    if (!s) return;
    this.pendingDelete.set(null);
    this.api.delete(s.id).subscribe({
      next: () => {
        this.toast.success('Scanner deleted', s.ip ?? '');
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not delete scanner'),
    });
  }
}
