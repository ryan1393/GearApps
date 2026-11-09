import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: '[danaDashboardPanel]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content></ng-content>',
  host: { class: 'dana-dashboard-panel dana-panel' },
})
export class DanaDashboardPanelComponent {}
