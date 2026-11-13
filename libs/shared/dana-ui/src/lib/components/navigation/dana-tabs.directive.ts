import { Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

/** What the tablist needs from each tab to keep exactly one tab in the Tab order. */
export interface DanaTabsMember {
  readonly active: boolean;
  readonly element: HTMLElement;
}

@Directive({ selector: '[danaTabs]', standalone: true, host: { class: 'dana-tabs', role: 'tablist' } })
export class DanaTabsDirective implements OnDestroy {
  private readonly members = new Set<DanaTabsMember>();
  private refreshScheduled = false;
  private destroyed = false;
  constructor(private readonly host: ElementRef<HTMLElement>) {}

  register(tab: DanaTabsMember): void { this.members.add(tab); this.refresh(); }
  unregister(tab: DanaTabsMember): void { this.members.delete(tab); this.refresh(); }

  /** Recomputes the roving tab stop once all tabs in this change-detection pass have updated. */
  refresh(): void {
    if (this.refreshScheduled || this.destroyed) return;
    this.refreshScheduled = true;
    queueMicrotask(() => {
      this.refreshScheduled = false;
      if (this.destroyed) return;
      const stop = this.tabStop();
      for (const member of this.members) member.element.setAttribute('tabindex', member === stop ? '0' : '-1');
    });
  }

  ngOnDestroy(): void { this.destroyed = true; this.members.clear(); }

  /**
   * The tab reachable with Tab: the active one, or, when no tab is marked active, the first
   * enabled tab in document order, so the tablist is never skipped.
   */
  private tabStop(): DanaTabsMember | undefined {
    let first: DanaTabsMember | undefined;
    for (const member of this.members) {
      if (member.active) return member;
      if ((member.element as HTMLButtonElement).disabled) continue;
      if (!first || first.element.compareDocumentPosition(member.element) & Node.DOCUMENT_POSITION_PRECEDING) first = member;
    }
    return first;
  }

  @HostListener('keydown', ['$event']) onKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[danaTab]:not([disabled])'));
    if (!tabs.length) return;
    const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus();
  }
}
