import { Directive, HostBinding, Input } from '@angular/core';
export type DanaButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'dark';
@Directive({ selector: 'button[danaButton], a[danaButton]', standalone: true, host: { class: 'dana-btn gear-btn' } })
export class DanaButtonDirective {
  @Input() danaButton: DanaButtonVariant = 'secondary';
  @HostBinding('class.dana-btn-primary') get danaPrimary(){ return this.danaButton === 'primary'; }
  @HostBinding('class.gear-btn-primary') get gearPrimary(){ return this.danaPrimary; }
  @HostBinding('class.dana-btn-secondary') get danaSecondary(){ return this.danaButton === 'secondary'; }
  @HostBinding('class.gear-btn-secondary') get gearSecondary(){ return this.danaSecondary; }
  @HostBinding('class.dana-btn-success') get danaSuccess(){ return this.danaButton === 'success'; }
  @HostBinding('class.gear-btn-success') get gearSuccess(){ return this.danaSuccess; }
  @HostBinding('class.dana-btn-danger') get danaDanger(){ return this.danaButton === 'danger'; }
  @HostBinding('class.gear-btn-danger') get gearDanger(){ return this.danaDanger; }
  @HostBinding('class.dana-btn-dark') get danaDark(){ return this.danaButton === 'dark'; }
  @HostBinding('class.gear-btn-dark') get gearDark(){ return this.danaDark; }
}
