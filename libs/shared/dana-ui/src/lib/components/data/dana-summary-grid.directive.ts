import { Directive } from '@angular/core';

@Directive({
  selector: '[danaSummaryGrid]',
  standalone: true,
  host: {
    class: 'dana-summary-grid',
  },
})
export class DanaSummaryGridDirective {}
