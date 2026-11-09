import { Directive, HostBinding, Input } from '@angular/core';

@Directive({
  selector: '[danaResponsiveGrid]',
  standalone: true,
})
export class DanaResponsiveGridDirective {
  @HostBinding('class.dana-responsive-grid') readonly hostClass = true;
  @Input() danaColumns: number | string = 4;
  @Input() danaCompactColumns: number | string = 2;
  @Input() danaMobileColumns: number | string = 1;
  @Input() danaGridGap = 'var(--gear-space-4, 16px)';

  @HostBinding('style.--dana-grid-columns') get columns(): string { return String(this.danaColumns); }
  @HostBinding('style.--dana-grid-compact-columns') get compactColumns(): string { return String(this.danaCompactColumns); }
  @HostBinding('style.--dana-grid-mobile-columns') get mobileColumns(): string { return String(this.danaMobileColumns); }
  @HostBinding('style.--dana-grid-gap') get gap(): string { return this.danaGridGap; }
}
