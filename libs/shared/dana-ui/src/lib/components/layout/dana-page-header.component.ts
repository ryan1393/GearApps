import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: '[danaPageHeader]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'dana-page-header gear-page-header',
  },
  template: `
    <div>
      <p class="dana-eyebrow gear-eyebrow">{{ eyebrow }}</p>
      <h1 [class.dana-page-title]="!dashboard" [class.gear-page-title]="!dashboard">{{ heading }}</h1>
      <p [class.dana-page-description]="!dashboard" [class.gear-page-description]="!dashboard">{{ description }}</p>
    </div>
    <ng-content select="[danaPageHeaderAction]"></ng-content>
  `,
})
export class DanaPageHeaderComponent {
  @Input() eyebrow = '';
  @Input() heading = '';
  @Input() description = '';
  @Input() dashboard = false;
}
