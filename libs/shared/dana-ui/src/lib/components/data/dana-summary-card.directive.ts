import { Directive } from '@angular/core';

@Directive({
  selector: '[danaSummaryCard]',
  standalone: true,
  host: {
    class: 'dana-summary-card',
  },
})
export class DanaSummaryCardDirective {}
