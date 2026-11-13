import { Directive, ElementRef, HostBinding, Input, OnChanges, OnDestroy, Renderer2, inject } from '@angular/core';
export type DanaButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'dark';

let nextDisabledReasonId = 0;

@Directive({ selector: 'button[danaButton], a[danaButton]', standalone: true, host: { class: 'dana-btn gear-btn' } })
export class DanaButtonDirective implements OnChanges, OnDestroy {
  @Input() danaButton: DanaButtonVariant = 'secondary';
  /**
   * Optional short sentence that says why the action is unavailable. While the button is disabled
   * (or `aria-disabled="true"`), it is shown next to the button and linked with aria-describedby.
   */
  @Input() danaDisabledReason: string | null | undefined;

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

  private readonly host = inject<ElementRef<HTMLButtonElement | HTMLAnchorElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly reasonId = `dana-disabled-reason-${++nextDisabledReasonId}`;
  private reasonElement?: HTMLElement;
  private observer?: MutationObserver;

  ngOnChanges(): void {
    const element = this.host.nativeElement;
    if (this.reasonText() && !this.observer && typeof MutationObserver !== 'undefined') {
      // [disabled] reflects to the attribute, so the reason follows the button's state.
      this.observer = new MutationObserver(() => this.syncDisabledReason());
      this.observer.observe(element, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
    } else if (!this.reasonText()) {
      this.observer?.disconnect();
      this.observer = undefined;
    }
    this.syncDisabledReason();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.removeDisabledReason();
  }

  private reasonText(): string {
    return (this.danaDisabledReason ?? '').trim();
  }

  private isDisabled(): boolean {
    const element = this.host.nativeElement;
    return (element as HTMLButtonElement).disabled === true || element.getAttribute('aria-disabled') === 'true';
  }

  private syncDisabledReason(): void {
    const text = this.reasonText();
    if (!text || !this.isDisabled()) {
      this.removeDisabledReason();
      return;
    }
    const element = this.host.nativeElement;
    const parent = this.renderer.parentNode(element);
    if (!parent) return;
    if (!this.reasonElement) {
      this.reasonElement = this.renderer.createElement('span') as HTMLElement;
      this.renderer.addClass(this.reasonElement, 'dana-disabled-reason');
      this.renderer.setAttribute(this.reasonElement, 'id', this.reasonId);
    }
    this.renderer.setProperty(this.reasonElement, 'textContent', text);
    if (this.reasonElement.parentNode !== parent || this.reasonElement.previousSibling !== element) {
      this.renderer.insertBefore(parent, this.reasonElement, this.renderer.nextSibling(element));
    }
    const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (!ids.includes(this.reasonId)) {
      this.renderer.setAttribute(element, 'aria-describedby', [...ids, this.reasonId].join(' '));
    }
  }

  private removeDisabledReason(): void {
    const element = this.host.nativeElement;
    const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.includes(this.reasonId)) {
      const rest = ids.filter(id => id !== this.reasonId);
      if (rest.length) this.renderer.setAttribute(element, 'aria-describedby', rest.join(' '));
      else this.renderer.removeAttribute(element, 'aria-describedby');
    }
    if (this.reasonElement?.parentNode) this.renderer.removeChild(this.reasonElement.parentNode, this.reasonElement);
  }
}
