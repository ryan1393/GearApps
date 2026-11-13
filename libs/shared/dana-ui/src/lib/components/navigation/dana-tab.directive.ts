import { Directive, ElementRef, HostBinding, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { DanaTabsDirective, DanaTabsMember } from './dana-tabs.directive';
@Directive({ selector: 'button[danaTab], a[danaTab]', standalone: true, host: { class: 'dana-tab', role: 'tab' } })
export class DanaTabDirective implements DanaTabsMember, OnInit, OnDestroy {
  private isActiveTab = false;
  @Input() set active(value: boolean) { this.isActiveTab = value; this.tabs?.refresh(); }
  get active(): boolean { return this.isActiveTab; }
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly tabs = inject(DanaTabsDirective, { optional: true });
  @HostBinding('class.is-active') get isActive(){return this.active}
  @HostBinding('attr.aria-selected') get ariaSelected(){return String(this.active)}
  ngOnInit(): void {
    // The tablist keeps one roving tab stop; a tab outside a tablist stays in the Tab order.
    if (this.tabs) this.tabs.register(this);
    else this.element.setAttribute('tabindex', '0');
  }
  ngOnDestroy(): void { this.tabs?.unregister(this); }
}
