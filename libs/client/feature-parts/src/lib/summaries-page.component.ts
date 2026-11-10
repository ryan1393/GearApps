import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import {
  DanaCountBadgeDirective,
  DanaPageHeaderComponent,
  DanaPanelHeaderDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import { LapperAccess, loadable, SummariesApi, ToastService } from '@gearapps/client/core';
import { StatusBadgeComponent } from '@gearapps/client/ui';
import { Summary } from '@gearapps/shared/domain';
import { userName } from './shared';
import { SummaryFormDialogComponent } from './summary-form-dialog.component';

@Component({
  selector: 'gear-summaries-page',
  imports: [
    DanaCountBadgeDirective,
    DanaPageHeaderComponent,
    DanaPanelHeaderDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaTableShellDirective,
    StatusBadgeComponent,
    SummaryFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gear-page">
      <section
        danaPageHeader
        eyebrow="LAPPER / REFERENCE"
        heading="Part Summaries"
        description="Summary numbers that group rings, pinions and gearsets by model and hand of spiral."
      >
        <div danaPageHeaderAction class="dana-toolbar">
          <button
            type="button"
            class="gear-btn gear-btn-secondary"
            (click)="reload()"
            [disabled]="summaries.loading()"
          >
            ↻ {{ summaries.loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          @if (access.canEditSetup()) {
            <button type="button" class="gear-btn gear-btn-primary" (click)="open(null)">
              + Add summary
            </button>
          }
        </div>
      </section>

      <section class="gear-panel data-panel">
        <div danaPanelHeader class="gear-panel-header gear-panel-heading panel-heading panel-row">
          <div>
            <h2>All Summaries</h2>
            <p>Sort by any column or filter with the funnel.</p>
          </div>
          <span danaCountBadge class="gear-count-badge count-chip">{{
            summaries.value().length
          }}</span>
        </div>
        <div danaTableShell class="table-wrap">
          <table danaTable class="gear-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Model</th>
                <th>HOS</th>
                <th>Status</th>
                <th>Created by</th>
                <th data-dana-table-static aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (s of summaries.value(); track s.id) {
                <tr>
                  <td class="mono strong">{{ s.number }}</td>
                  <td>{{ s.model || '—' }}</td>
                  <td>{{ s.hos || '—' }}</td>
                  <td><gear-status-badge [status]="s.status" /></td>
                  <td>{{ userName(s.user) }}</td>
                  <td class="right">
                    @if (access.canEditSetup()) {
                      <div class="gear-actions">
                        <button
                          type="button"
                          class="gear-btn gear-btn-secondary gear-btn-sm"
                          (click)="open(s)"
                          [attr.aria-label]="'Edit ' + s.number"
                        >
                          Edit
                        </button>
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td danaTableEmpty colspan="6" class="empty-row">
                    {{ summaries.loading() ? 'Loading summaries…' : 'No part summaries yet.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <gear-summary-form-dialog [(open)]="dialog" [summary]="editing()" (saved)="onSaved()" />
  `,
})
export class SummariesPageComponent implements OnInit {
  private readonly api = inject(SummariesApi);
  private readonly toast = inject(ToastService);
  protected readonly access = inject(LapperAccess);
  protected readonly summaries = loadable<Summary[]>([]);
  protected readonly userName = userName;
  protected dialog = false;
  protected readonly editing = signal<Summary | null>(null);

  ngOnInit() {
    this.reload();
  }
  protected reload() {
    this.summaries.load(this.api.list());
  }
  protected open(s: Summary | null) {
    this.editing.set(s);
    this.dialog = true;
  }
  protected onSaved() {
    this.toast.success('Summary saved');
    this.reload();
  }
  // Part summaries are shared GearApps master data. The API refuses to delete them from Lapper,
  // so no Delete action is offered here; set one Inactive with Edit instead.
}
