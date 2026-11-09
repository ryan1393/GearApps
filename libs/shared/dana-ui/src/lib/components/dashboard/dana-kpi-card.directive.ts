import { Directive } from '@angular/core';

@Directive({
  selector: '[danaKpiCard]',
  standalone: true,
  host: { class: 'dana-kpi-card kpi-card' },
})
export class DanaKpiCardDirective {}
