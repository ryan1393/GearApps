import { Directive, ElementRef, HostListener } from '@angular/core';
@Directive({ selector: '[danaTabs]', standalone: true, host: { class: 'dana-tabs', role: 'tablist' } })
export class DanaTabsDirective {
  constructor(private readonly host: ElementRef<HTMLElement>) {}
  @HostListener('keydown', ['$event']) onKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[danaTab]:not([disabled])'));
    if (!tabs.length) return;
    const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus();
  }
}
