import { Directive, HostBinding, Input } from '@angular/core';

@Directive({
  selector: '[danaStack]',
  standalone: true,
})
export class DanaStackDirective {
  @HostBinding('class.dana-stack') readonly hostClass = true;
  @Input() danaStackGap = 'var(--dana-action-gap, 12px)';
  @Input() danaStackAlign = 'stretch';
  @Input() danaStackJustify = 'flex-start';
  @Input() danaStackMobile = false;

  @HostBinding('class.dana-stack-mobile') get mobile(): boolean { return this.danaStackMobile; }
  @HostBinding('style.--dana-stack-gap') get gap(): string { return this.danaStackGap; }
  @HostBinding('style.--dana-stack-align') get align(): string { return this.danaStackAlign; }
  @HostBinding('style.--dana-stack-justify') get justify(): string { return this.danaStackJustify; }
}
