import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DanaConfirmDialogComponent, DanaTableDirective } from '@dana/ui';
import { loadable, SummariesApi, ToastService } from '@gearapps/client/core';
import { EmptyStateComponent, StatusBadgeComponent } from '@gearapps/client/ui';
import { Summary } from '@gearapps/shared/domain';
import { userName } from './shared';
import { SummaryFormDialogComponent } from './summary-form-dialog.component';

@Component({
  selector: 'gear-summaries-page',
  imports: [
    DanaTableDirective,
    DanaConfirmDialogComponent,
    StatusBadgeComponent,
    EmptyStateComponent,
    SummaryFormDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-page-header">
      <div>
        <h1>Part summaries</h1>
        <p>Summary numbers that group parts and gearsets by model and HOS.</p>
      </div>
      <div class="dana-toolbar">
        <button type="button" class="dana-btn" (click)="reload()">Refresh</button>
        <button type="button" class="dana-btn dana-btn-primary" (click)="open(null)">
          + Add summary
        </button>
      </div>
    </div>

    <section class="dana-panel">
      <div class="dana-panel-header">
        <div>
          <h2>All summaries</h2>
          <small>{{ summaries.value().length }} total</small>
        </div>
      </div>
      @if (!summaries.loading() && !summaries.value().length) {
        <div class="dana-panel-body"><gear-empty-state title="No part summaries yet" /></div>
      } @else {
        <div class="dana-table-shell is-sticky-head">
          <table danaTable class="dana-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Model</th>
                <th>HOS</th>
                <th>Status</th>
                <th>Created by</th>
                <th data-dana-table-static>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (s of summaries.value(); track s.id) {
                <tr>
                  <td>
                    <strong>{{ s.number }}</strong>
                  </td>
                  <td>{{ s.model }}</td>
                  <td>{{ s.hos }}</td>
                  <td><gear-status-badge [status]="s.status" /></td>
                  <td>{{ userName(s.user) }}</td>
                  <td>
                    <div class="dana-table-actions">
                      <button type="button" class="dana-btn dana-btn-sm" (click)="open(s)">
                        Edit
                      </button>
                      <button
                        type="button"
                        class="dana-btn dana-btn-sm dana-btn-danger"
                        (click)="pending.set(s)"
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

    <gear-summary-form-dialog [(open)]="dialog" [summary]="editing()" (saved)="onSaved()" />
    <dana-confirm-dialog
      [open]="!!pending()"
      title="Delete summary"
      [message]="'Delete summary ' + pending()?.number + '? Parts referencing it lose the link.'"
      confirmLabel="Delete"
      [danger]="true"
      (confirm)="deleteConfirmed()"
      (cancel)="pending.set(null)"
    />
  `,
})
export class SummariesPageComponent implements OnInit {
  private readonly api = inject(SummariesApi);
  private readonly toast = inject(ToastService);
  protected readonly summaries = loadable<Summary[]>([]);
  protected readonly userName = userName;
  protected dialog = false;
  protected readonly editing = signal<Summary | null>(null);
  protected readonly pending = signal<Summary | null>(null);

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
  protected deleteConfirmed() {
    const s = this.pending();
    if (!s) return;
    this.pending.set(null);
    this.api.delete(s.id).subscribe({
      next: () => {
        this.toast.success('Summary deleted', s.number);
        this.reload();
      },
      error: (err) => this.toast.error(err, 'Could not delete summary'),
    });
  }
}
