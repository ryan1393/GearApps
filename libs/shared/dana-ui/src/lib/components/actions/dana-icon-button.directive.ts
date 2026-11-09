import { Directive, HostBinding, Input } from '@angular/core';
@Directive({ selector: 'button[danaIconButton], a[danaIconButton]', standalone: true, host: { class: 'dana-icon-btn' } })
export class DanaIconButtonDirective {
  @Input() danaIconButton: 'default' | 'danger' = 'default';
  @HostBinding('class.dana-icon-btn-danger') get danger(){ return this.danaIconButton === 'danger'; }
}
