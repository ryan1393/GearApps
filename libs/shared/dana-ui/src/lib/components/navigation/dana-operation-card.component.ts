import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type DanaOperationTone = 'blue' | 'green' | 'purple' | 'orange' | 'teal' | 'gray';

@Component({
  selector: 'a[danaOperationCard]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-operation-card operation-card' },
  template: `
    <span [class]="'dana-operation-icon operation-icon ' + tone" [attr.data-tone]="tone" aria-hidden="true">
      <span [class]="'gear-glyph gear-glyph-' + resolvedIcon + ' dana-glyph dana-glyph-' + resolvedIcon"></span>
    </span>
    <span class="dana-operation-copy operation-copy"><strong>{{ heading }}</strong><small>{{ description }}</small></span>
    <span class="dana-operation-arrow operation-arrow" aria-hidden="true"></span>
  `,
})
export class DanaOperationCardComponent {
  @Input() icon = 'search';
  @Input() tone: DanaOperationTone = 'blue';
  @Input() heading = '';
  @Input() description = '';

  get resolvedIcon(): string {
    return this.icon?.trim() || 'search';
  }
}
