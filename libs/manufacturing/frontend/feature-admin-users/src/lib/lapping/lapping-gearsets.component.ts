import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import {
  DanaConfirmDialogComponent,
  DanaCountBadgeDirective,
  DanaPanelHeaderDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import { GearsetsApi, loadable, PartsApi, SummariesApi, ToastService } from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
import { getDanaAppUrl } from '@gearapps/manufacturing/shared/dana-app-config';
import { Gearset, Part, Summary } from '@gearapps/shared/domain';
import { GearsetFormDialogComponent } from './gearset-form-dialog.component';

/**
 * Gearset assemblies: a pinion and a ring from the same Part Summary, lapped together. Creating one
 * adds the GEARSET part and the shared assembly record that Lapping cycles reference.
 */
@Component({
  selector: 'gear-admin-lapping-gearsets',
  imports: [
    DecimalPipe,
    DanaConfirmDialogComponent,
    DanaCountBadgeDirective,
    DanaPanelHeaderDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
    GearsetFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="gear-panel data-panel">
      <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
        <div>
          <h2>Gearsets</h2>
          <p>
            Pair a pinion with a ring from the same Part Summary. Number, parts and Summary are
            fixed once a gearset is assembled; revision and status can change.
          </p>
        </div>
        <div class="dana-toolbar">
          <span danaCountBadge class="gear-count-badge count-chip">{{ gearsets.value().length }}</span>
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="gearsets.loading()"
           data-icon="refresh" title="Refresh">
            ↻ {{ gearsets.loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button type="button" class="gear-btn gear-btn-primary" (click)="open(null)">
            + Add gearset
          </button>
        </div>
      </div>
      <div danaTableShell class="table-wrap">
        <table danaTable class="gear-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Rev</th>
              <th>Pinion / Ring</th>
              <th>Ratio</th>
              <th>Summary</th>
              <th>Status</th>
              <th data-dana-table-static aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            @for (g of gearsets.value(); track g.id) {
              <tr>
                <td class="mono strong">{{ g.number }}</td>
                <td>{{ g.rev || '—' }}</td>
                <td class="mono nowrap">
                  {{ g.pinion?.number ?? '—' }} / {{ g.ring?.number ?? '—' }}
                </td>
                <td class="nowrap">
                  {{ g.ratio !== null && g.ratio !== undefined ? (g.ratio | number: '1.2-4') : '—' }}
                  @if (g.pinion?.teeth && g.ring?.teeth) {
                    <span class="gear-muted">({{ g.ring?.teeth }}:{{ g.pinion?.teeth }})</span>
                  }
                </td>
                <td class="mono">{{ g.summary?.number ?? '—' }}</td>
                <td><gear-status-badge [status]="g.status" /></td>
                <td class="right">
                  <div class="gear-actions">
                    <a
                      class="gear-btn gear-btn-secondary gear-btn-sm"
                      [href]="lappingSummaryUrl(g)"
                      [attr.aria-label]="'Lapping summary for ' + g.number"
                      >Lapping summary</a
                    >
                    <button
                      type="button"
                      class="gear-btn gear-btn-secondary gear-btn-sm"
                      (click)="open(g)"
                      [attr.aria-label]="'Edit ' + g.number"
                     data-icon="edit" title="Edit">
                      Edit
                    </button>
                    <button
                      type="button"
                      class="gear-btn gear-btn-danger gear-btn-sm"
                      (click)="pendingDelete.set(g)"
                      [attr.aria-label]="'Delete ' + g.number"
                     data-icon="delete" title="Delete">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td danaTableEmpty colspan="7" class="empty-row">
                  {{
                    gearsets.loading()
                      ? 'Loading gearsets…'
                      : 'No gearsets yet. A gearset pairs a pinion with a ring from the same Part Summary.'
                  }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <gear-gearset-form-dialog
      [(open)]="dialogOpen"
      [gearset]="editing()"
      [parts]="parts.value()"
      [summaries]="summaries.value()"
      (saved)="onSaved()"
    />
    <dana-confirm-dialog
      [open]="!!pendingDelete()"
      title="Delete gearset"
      [message]="
        'Delete gearset ' +
        (pendingDelete()?.number ?? '') +
        '? Only gearsets reported by a collector and never assembled can be deleted; assembled gearsets are shared records, so set them Inactive instead.'
      "
      confirmLabel="Delete"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pendingDelete.set(null)"
    />
  `,
})
export class LappingGearsetsComponent implements OnInit {
  private readonly gearsetsApi = inject(GearsetsApi);
  private readonly partsApi = inject(PartsApi);
  private readonly summariesApi = inject(SummariesApi);
  private readonly toast = inject(ToastService);

  protected readonly gearsets = loadable<Gearset[]>([]);
  protected readonly parts = loadable<Part[]>([]);
  protected readonly summaries = loadable<Summary[]>([]);
  protected dialogOpen = false;
  protected readonly editing = signal<Gearset | null>(null);
  protected readonly pendingDelete = signal<Gearset | null>(null);

  ngOnInit() {
    this.reload();
  }

  protected reload() {
    this.gearsets.load(this.gearsetsApi.list());
    this.parts.load(this.partsApi.list());
    this.summaries.load(this.summariesApi.list());
  }

  protected open(gearset: Gearset | null) {
    this.editing.set(gearset);
    this.dialogOpen = true;
  }

  protected onSaved() {
    this.toast.success(this.editing() ? 'Gearset updated' : 'Gearset added');
    this.reload();
  }

  protected lappingSummaryUrl(gearset: Gearset): string {
    return `${getDanaAppUrl('lapper')}/lapping-summaries?gearset=${encodeURIComponent(gearset.id)}`;
  }

  protected deleteConfirmed() {
    const gearset = this.pendingDelete();
    if (!gearset) return;
    this.pendingDelete.set(null);
    this.gearsetsApi.delete(gearset.id).subscribe({
      next: () => {
        this.toast.success('Gearset deleted', gearset.number);
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not delete gearset'),
    });
  }
}
