import { Directive } from '@angular/core';
@Directive({ selector: '[danaToolbar]', standalone: true, host: { class: 'dana-toolbar gear-actions' } })
export class DanaToolbarDirective {}
