import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
@Component({ selector: 'dana-detail-item', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'dana-detail gear-detail' }, template: `<span class="dana-detail-label gear-detail-label">{{ label }}</span><span class="dana-detail-value gear-detail-value"><ng-content></ng-content>{{ value }}</span>` })
export class DanaDetailItemComponent { @Input() label = ''; @Input() value = ''; }
