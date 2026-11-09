import { Directive, HostListener, Input } from '@angular/core';

@Directive({
  selector: '[danaMobileNav]',
  standalone: true,
  exportAs: 'danaMobileNav',
})
export class DanaMobileNavDirective {
  /** Match the consuming app's CSS desktop breakpoint. */
  @Input() desktopMinWidth = 1025;
  open = false;

  private isDesktop(): boolean {
    const configuredWidth = Number(this.desktopMinWidth);
    const width = Number.isSafeInteger(configuredWidth) && configuredWidth > 0 ? configuredWidth : 1025;
    return typeof window !== 'undefined' && window.matchMedia(`(min-width: ${width}px)`).matches;
  }

  toggle(): void {
    if (this.isDesktop()) {
      this.open = false;
      document.querySelector<HTMLElement>('.dana-sidebar .dana-side-link')?.focus();
      return;
    }
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.isDesktop()) {
      this.close();
    }
  }
}
