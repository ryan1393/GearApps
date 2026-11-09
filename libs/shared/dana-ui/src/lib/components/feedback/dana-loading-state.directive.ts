import { Directive } from '@angular/core';

@Directive({
  selector: '[danaLoadingState]',
  standalone: true,
  host: { role: 'status', 'aria-live': 'polite' },
})
export class DanaLoadingStateDirective {}
