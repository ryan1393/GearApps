import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'gear-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-empty-state lapper-empty">
      <strong>{{ title() }}</strong>
      @if (hint()) {
        <span>{{ hint() }}</span>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .lapper-empty {
      display: grid;
      gap: var(--dana-space-2);
      justify-items: start;
    }
  `,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly hint = input<string>();
}
