import { Directive, HostBinding, Input } from '@angular/core';
export type DanaAlertTone = 'info' | 'success' | 'warning' | 'danger';
@Directive({ selector: '[danaAlert]', standalone: true, host: { class: 'dana-alert gear-alert' } })
export class DanaAlertDirective {
  @Input() danaAlert: DanaAlertTone = 'info';
  /** Danger alerts interrupt (role=alert); every other tone is a polite status message. */
  @HostBinding('attr.role') get role(){return this.danaAlert==='danger'?'alert':'status'}
  @HostBinding('class.dana-alert-info') get info(){return this.danaAlert==='info'}
  @HostBinding('class.dana-alert-success') get success(){return this.danaAlert==='success'}
  @HostBinding('class.gear-alert-success') get gearSuccess(){return this.success}
  @HostBinding('class.dana-alert-warning') get warning(){return this.danaAlert==='warning'}
  @HostBinding('class.gear-alert-warning') get gearWarning(){return this.warning}
  @HostBinding('class.dana-alert-danger') get danger(){return this.danaAlert==='danger'}
  @HostBinding('class.gear-alert-danger') get gearDanger(){return this.danger}
}
