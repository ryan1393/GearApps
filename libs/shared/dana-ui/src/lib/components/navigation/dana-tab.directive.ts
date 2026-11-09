import { Directive, HostBinding, Input } from '@angular/core';
@Directive({ selector: 'button[danaTab], a[danaTab]', standalone: true, host: { class: 'dana-tab', role: 'tab' } })
export class DanaTabDirective {
  @Input() active=false;
  @HostBinding('class.is-active') get isActive(){return this.active}
  @HostBinding('attr.aria-selected') get ariaSelected(){return String(this.active)}
  @HostBinding('attr.tabindex') get tabIndex(){return this.active ? 0 : -1}
}
