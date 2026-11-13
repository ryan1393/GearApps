import { DOCUMENT } from '@angular/common';
import { Directive, effect, ElementRef, inject, input, OnDestroy } from '@angular/core';

let nextId = 0;

/**
 * A short explanation shown beside a control while it is hovered or has keyboard focus, and
 * announced through aria-describedby. Escape hides it. Use it instead of `title`, whose tooltip is
 * slow, unstyled and never shown to keyboard users; an icon-only control still needs its own
 * accessible name (its text or aria-label).
 */
@Directive({
  selector: '[danaTooltip]',
  standalone: true,
  host: {
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
    '(click)': 'hide()',
  },
})
export class DanaTooltipDirective implements OnDestroy {
  /** The text to show; empty shows nothing. */
  readonly danaTooltip = input<string | null | undefined>('');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly id = `dana-tooltip-${++nextId}`;
  private tip: HTMLElement | null = null;

  constructor() {
    // Keep an open tooltip in step with its text (e.g. a state shown in it changes).
    effect(() => {
      const text = this.danaTooltip();
      if (!this.tip) return;
      if (text) {
        this.tip.textContent = text;
        this.place();
      } else {
        this.hide();
      }
    });
  }

  show(): void {
    const text = this.danaTooltip();
    if (!text || this.tip) return;
    const tip = this.doc.createElement('div');
    tip.className = 'dana-tooltip';
    tip.id = this.id;
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    this.doc.body.appendChild(tip);
    this.tip = tip;
    const el = this.host.nativeElement;
    const described = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', described ? `${described} ${this.id}` : this.id);
    this.place();
  }

  hide(): void {
    if (!this.tip) return;
    this.tip.remove();
    this.tip = null;
    const el = this.host.nativeElement;
    const rest = (el.getAttribute('aria-describedby') ?? '').split(' ').filter((t) => t && t !== this.id);
    if (rest.length) el.setAttribute('aria-describedby', rest.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  ngOnDestroy(): void {
    this.hide();
  }

  /** Above the control, centred and kept on screen; below it when there is no room above. */
  private place(): void {
    const tip = this.tip;
    const view = this.doc.defaultView;
    if (!tip || !view) return;
    const gap = 8;
    const box = this.host.nativeElement.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const above = box.top - size.height - gap;
    const top = above >= gap ? above : box.bottom + gap;
    const left = Math.min(Math.max(gap, box.left + box.width / 2 - size.width / 2), view.innerWidth - size.width - gap);
    tip.dataset['placement'] = above >= gap ? 'top' : 'bottom';
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(Math.max(gap, left))}px`;
  }
}
