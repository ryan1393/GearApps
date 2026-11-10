import { DOCUMENT } from '@angular/common';
import { AfterViewInit, Directive, ElementRef, Input, OnDestroy, inject } from '@angular/core';

/**
 * Keeps the cursor in the scan field an operator needs next, without moving it away from a
 * control the operator chose.
 *
 * A bare `gearScannerFocus` is the first scan of a workflow. Later scans pass their order,
 * e.g. `[gearScannerFocus]="2"`. The field takes focus when it first appears and each time it
 * becomes usable again after the page was busy, but only once every earlier scan step is filled
 * in, and only if nothing has focus or the cursor is still in an earlier scan step. A hand
 * scanner types into whatever has focus, so a lost cursor silently drops the next scan.
 */
@Directive({ selector: 'input[gearScannerFocus]', standalone: true })
export class GearScannerFocusDirective implements AfterViewInit, OnDestroy {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private observer?: MutationObserver;
  private pending?: ReturnType<typeof setTimeout>;
  private scanStep = 1;

  @Input('gearScannerFocus') set step(value: number | string | null | undefined) {
    const step = Number(value);
    this.scanStep = Number.isFinite(step) && step > 0 ? step : 1;
    this.input.nativeElement.dataset['gearScanStep'] = String(this.scanStep);
  }

  ngAfterViewInit(): void {
    const element = this.input.nativeElement;
    element.dataset['gearScanStep'] = String(this.scanStep);
    this.claim(true);
    if (typeof MutationObserver === 'undefined') return;
    // ngModel applies [disabled] after change detection, so watch the element itself.
    this.observer = new MutationObserver(() => {
      if (element.disabled) return;
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.claim(false));
    });
    this.observer.observe(element, { attributes: true, attributeFilter: ['disabled'] });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    clearTimeout(this.pending);
  }

  /**
   * `appearing`: this field has just been rendered, which for a later step is the direct result
   * of what the operator did (a scan, or a choice in a list or on a button), so it may also take
   * the cursor from that list or button. It never takes it from a field being typed in.
   */
  private claim(appearing: boolean): void {
    const element = this.input.nativeElement;
    if (element.disabled || !this.earlierStepsFilled()) return;
    const active = this.document.activeElement as HTMLElement | null;
    const idle = !active || active === this.document.body;
    const activeStep = Number(active?.dataset?.['gearScanStep']);
    const onEarlierStep = active !== element && Number.isFinite(activeStep) && activeStep < this.scanStep;
    const onChoiceControl = appearing && this.scanStep > 1 && !!active && ['SELECT', 'BUTTON'].includes(active.tagName);
    if (idle || onEarlierStep || onChoiceControl) {
      element.focus({ preventScroll: true });
      element.select();
    }
  }

  /** A later step waits its turn: while an earlier scan on the page is still empty, that one is next. */
  private earlierStepsFilled(): boolean {
    const scans = this.document.querySelectorAll<HTMLInputElement>('input[data-gear-scan-step]');
    return Array.from(scans).every((scan) =>
      scan === this.input.nativeElement || Number(scan.dataset['gearScanStep']) >= this.scanStep || scan.value.trim() !== '');
  }
}
