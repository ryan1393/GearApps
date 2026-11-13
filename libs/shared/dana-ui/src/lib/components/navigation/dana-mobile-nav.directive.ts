import { afterNextRender, Directive, ElementRef, HostBinding, HostListener, Injector, Input, OnDestroy } from '@angular/core';

@Directive({
  selector: '[danaMobileNav]',
  standalone: true,
  exportAs: 'danaMobileNav',
})
export class DanaMobileNavDirective implements OnDestroy {
  /** Match the consuming app's CSS desktop breakpoint. */
  @Input() desktopMinWidth = 1025;
  /** Opt in when this navigation is an overlay drawer with a separate opener. */
  @Input() modal = false;
  open = false;
  private opener?: HTMLElement;
  private destroyed = false;

  constructor(private readonly host: ElementRef<HTMLElement>, private readonly injector: Injector) {}

  @HostBinding('attr.role') get role(): string | null { return this.modal && this.open && !this.isDesktop() ? 'dialog' : null; }
  @HostBinding('attr.aria-modal') get ariaModal(): string | null { return this.modal && this.open && !this.isDesktop() ? 'true' : null; }

  private isDesktop(): boolean {
    const configuredWidth = Number(this.desktopMinWidth);
    const width = Number.isSafeInteger(configuredWidth) && configuredWidth > 0 ? configuredWidth : 1025;
    return typeof window !== 'undefined' && window.matchMedia(`(min-width: ${width}px)`).matches;
  }

  toggle(): void {
    if (this.isDesktop()) {
      this.open = false;
      this.focusable()[0]?.focus();
      return;
    }
    if (this.open) { this.close(); return; }
    this.opener = this.host.nativeElement.ownerDocument.activeElement as HTMLElement | undefined;
    this.open = true;
    if (this.modal) {
      afterNextRender(() => {
        if (!this.destroyed && this.open && !this.isDesktop()) this.focusFirst();
      }, { injector: this.injector });
    }
  }

  close(restoreFocus = true): void {
    const wasOpen = this.open;
    this.open = false;
    if (wasOpen && this.modal && restoreFocus && this.opener?.isConnected) this.opener.focus();
    this.opener = undefined;
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.open || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onEscape();
      return;
    }
    if (!this.modal || this.isDesktop() || event.key !== 'Tab') return;
    const controls = this.focusable();
    const first = controls[0];
    const last = controls[controls.length - 1];
    const current = this.host.nativeElement.ownerDocument.activeElement;
    if (!first || (event.shiftKey ? current === first : current === last) ||
        !this.host.nativeElement.contains(current)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
      if (!first) this.focusFirst();
    }
  }

  onEscape(): void { this.close(); }

  @HostListener('window:resize')
  onResize(): void {
    if (this.isDesktop()) {
      // A docked navigation no longer owns a modal focus scope.
      this.close(false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.close();
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(
      'a[href],button,input,select,textarea,summary,[tabindex]',
    )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled,[aria-disabled="true"]') &&
      !element.closest('[inert]') && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden');
  }

  private focusFirst(): void {
    const first = this.focusable()[0];
    if (first) first.focus();
    else {
      const host = this.host.nativeElement;
      if (!host.hasAttribute('tabindex')) host.tabIndex = -1;
      host.focus();
    }
  }
}
