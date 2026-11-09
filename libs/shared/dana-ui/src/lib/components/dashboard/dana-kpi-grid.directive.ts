import { Directive } from '@angular/core';

@Directive({
  selector: '[danaKpiGrid]',
  standalone: true,
  host: { class: 'dana-kpi-grid kpi-grid' },
})
export class DanaKpiGridDirective {}
