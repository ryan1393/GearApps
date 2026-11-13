import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { Loadable } from '@meshforge/client/core';

import { loadErrorText } from './admin-data';

/**
 * Loading, failed and empty states for one Admin record list, so a list never claims
 * "no records" while it is still loading or after its request failed.
 */
@Component({
  selector: 'gear-admin-list-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (list.error() !== null) {
      <div class="gear-alert gear-alert-danger" role="alert">
        <strong>Could not load {{ noun }}.</strong>
        <span>{{ errorText() }}</span>
        <button type="button" class="gear-btn gear-btn-secondary" (click)="retry.emit()">Retry</button>
      </div>
    } @else if (list.loading() && !total) {
      <div class="gear-empty-state gear-admin-empty" role="status">Loading {{ noun }}…</div>
    } @else if (!list.loading() && !shown) {
      <div class="gear-empty-state gear-admin-empty">{{ total ? 'No ' + noun + ' match this search.' : (emptyText || 'No ' + noun + ' yet.') }}</div>
    }
  `,
  styles: [':host { display: contents; }'],
})
export class AdminListStateComponent {
  @Input({ required: true }) list!: Loadable<unknown>;
  /** Plural name, e.g. "trays". */
  @Input({ required: true }) noun!: string;
  /** Rows shown after the search. */
  @Input() shown = 0;
  /** Rows loaded. */
  @Input() total = 0;
  /** Replaces "No {noun} yet." when the list is empty. */
  @Input() emptyText = '';
  @Output() readonly retry = new EventEmitter<void>();

  errorText(): string { return loadErrorText(this.list.error()); }
}
