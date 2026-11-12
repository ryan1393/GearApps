import { DOCUMENT } from '@angular/common';
import { Directive, HostListener, Input, inject } from '@angular/core';

/** Focus a same-page target without Angular's base URL turning a fragment into navigation. */
@Directive({selector:'a[gearSkipLink]',standalone:true})
export class GearSkipLinkDirective {
  private readonly document=inject(DOCUMENT);
  @Input() gearSkipLink='main-content';

  @HostListener('click',['$event'])
  skip(event: MouseEvent): void {
    if(event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target=this.document.getElementById(this.gearSkipLink || 'main-content');
    if(!target) return;
    event.preventDefault();
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'start'});
  }
}
