import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DanaConfirmDialogComponent } from '@dana/ui';

import { AdminTabBase } from './admin-tab-base';

/**
 * The notices above an Admin tab's form ("Saved.", "Unable to continue.", choices that did not
 * load) and its in-page confirmation dialog.
 */
@Component({
  selector: 'gear-admin-feedback',
  standalone: true,
  imports: [DanaConfirmDialogComponent],
  // Checked with its tab: the tab's notices are plain fields.
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    @if (tab.error) {
      <div class="gear-alert gear-alert-danger" role="alert">
        <strong>Unable to continue.</strong>
        <span>{{ tab.error }}</span>
      </div>
    }
    @if (tab.message) {
      <div class="gear-alert gear-alert-success" role="status">
        <strong>Saved.</strong>
        <span>{{ tab.message }}</span>
      </div>
    }
    @if (tab.failedChoices.length) {
      <div class="gear-alert gear-alert-warning" role="alert">
        <strong>Some choices could not be loaded.</strong>
        <span>{{ tab.failedChoices.join(', ') }} — the form may be missing options.</span>
        <button type="button" class="gear-btn gear-btn-secondary" (click)="tab.retryChoices()">Retry</button>
      </div>
    }
    <dana-confirm-dialog [open]="!!tab.confirmation.request" [title]="tab.confirmation.request?.title || 'Confirm'"
      [message]="tab.confirmation.request?.message || ''" [confirmLabel]="tab.confirmation.request?.confirmLabel || 'Confirm'"
      [danger]="!!tab.confirmation.request?.danger" (confirm)="tab.confirmation.accept()" (cancel)="tab.confirmation.dismiss()" />
  `,
  styles: [':host { display: contents; }'],
})
export class AdminFeedbackComponent {
  @Input({ required: true }) tab!: AdminTabBase;
}
