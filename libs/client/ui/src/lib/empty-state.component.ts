import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'gear-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dana-empty-state gear-empty">
      <strong>{{ title() }}</strong>
      @if (hint()) {
        <span>{{ hint() }}</span>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .gear-empty {
      display: grid;
      gap: 6px;
      justify-items: start;
    }
    .gear-empty strong {
      color: var(--dana-text);
      font-size: 14px;
    }
  `,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly hint = input<string>();
}
