import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Native disclosure works with keyboard, pointer and touch without hover-only instructions. */
@Component({
  selector: 'dana-help',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<details class="dana-help" (keydown.escape)="close($event)">
    <summary [attr.aria-label]="label">?</summary>
    <div class="dana-help-content"><ng-content /></div>
  </details>`,
})
export class DanaHelpComponent {
  @Input() label = 'More information';
  close(event: Event): void {
    const details = event.currentTarget as HTMLDetailsElement;
    details.open = false;
    details.querySelector('summary')?.focus();
    event.stopPropagation();
  }
}
