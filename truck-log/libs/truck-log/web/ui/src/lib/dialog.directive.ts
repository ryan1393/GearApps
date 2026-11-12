import { AfterViewInit, Directive, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Accessible modal behaviour for an existing dialog card:
 *   <section class="dana-dialog" tlDialog="title-id" (tlDialogClose)="cancel()">
 *
 * - role="dialog" (or alertdialog), aria-modal="true", aria-labelledby=<title id>
 * - focus moves into the dialog when it opens ([autofocus] first, then the
 *   first focusable control, then the card itself) and returns to the element
 *   that had focus when the dialog closes
 * - Escape emits tlDialogClose; Tab/Shift+Tab stay inside the dialog
 */
@Directive({
  selector: '[tlDialog]',
  standalone: true,
  host: {
    '[attr.role]': 'tlDialogRole',
    '[attr.aria-modal]': '"true"',
    '[attr.aria-labelledby]': 'labelledBy || null',
    '[attr.tabindex]': '"-1"',
  },
})
export class TruckLogDialogDirective implements AfterViewInit, OnDestroy {
  /** id of the element that names the dialog. */
  @Input('tlDialog') labelledBy = '';
  @Input() tlDialogRole: 'dialog' | 'alertdialog' = 'dialog';
  /** Set false while a save is running so Escape cannot abandon it. */
  @Input() tlDialogEscape = true;
  @Output() readonly tlDialogClose = new EventEmitter<void>();

  private readonly previousFocus: HTMLElement | null =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private focusTimer?: number;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngAfterViewInit() {
    this.focusTimer = window.setTimeout(() => {
      const root: HTMLElement = this.host.nativeElement;
      if (root.contains(document.activeElement)) return;
      const preferred = root.querySelector<HTMLElement>('[autofocus]') ?? this.focusable()[0] ?? root;
      preferred.focus();
    });
  }

  ngOnDestroy() {
    if (this.focusTimer) window.clearTimeout(this.focusTimer);
    const previous = this.previousFocus;
    if (previous && previous.isConnected) window.setTimeout(() => previous.focus());
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      if (this.tlDialogEscape) this.tlDialogClose.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusable();
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /**
   * When the focused control disappears or becomes disabled while the dialog is open (a button
   * that disables itself, a scan field replaced by a status line), focus falls to <body> and the
   * host listener above stops hearing keys. Keep Escape and Tab working from there.
   */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.tlDialogEscape) this.tlDialogClose.emit();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      (this.focusable()[0] ?? this.host.nativeElement).focus();
    }
  }

  private focusable(): HTMLElement[] {
    const root: HTMLElement = this.host.nativeElement;
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.offsetParent !== null || element === document.activeElement);
  }
}
