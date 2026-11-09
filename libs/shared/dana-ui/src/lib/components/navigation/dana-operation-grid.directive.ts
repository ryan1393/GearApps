import { Directive } from '@angular/core';

@Directive({
  selector: '[danaOperationGrid]',
  standalone: true,
  host: {
    class: 'dana-operation-grid operation-grid',
  },
})
export class DanaOperationGridDirective {}
