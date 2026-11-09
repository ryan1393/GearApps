import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: '[danaDashboardGrid]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content></ng-content>',
  host: { class: 'dana-dashboard-grid' },
})
export class DanaDashboardGridComponent {}
