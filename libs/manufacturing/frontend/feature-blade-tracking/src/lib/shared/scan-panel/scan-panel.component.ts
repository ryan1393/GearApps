import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'gear-scan-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scan-panel.component.html',
  host: { '[attr.data-state]': 'state' },
})
export class ScanPanelComponent implements AfterViewInit, OnChanges {
  @Input() step = 1;
  @Input() label = 'Scan';
  @Input() help = '';
  @Input() placeholder = 'Scan barcode...';
  @Input() buttonText = 'Scan';
  @Input() disabled = false;
  @Input() autoFocus = true;
  /** The value this step has locked in. While set, the step shows it with a Change button instead of the scan box. */
  @Input() doneValue: string | null = null;
  @Input() changeText = 'Change';
  @Output() scanned = new EventEmitter<string>();
  /** The operator tapped Change on a completed step. */
  @Output() reopen = new EventEmitter<void>();
  @ViewChild('input') input?: ElementRef<HTMLInputElement>;

  private static nextId = 1;
  readonly inputId = `gear-scan-${ScanPanelComponent.nextId++}`;

  value = '';

  ngAfterViewInit(): void {
    this.claimFocus();
  }

  /** done: value locked in · disabled: not usable yet · ready: waiting for a scan. Styled by the operations station. */
  get state(): 'done' | 'disabled' | 'ready' {
    return this.doneValue ? 'done' : this.disabled ? 'disabled' : 'ready';
  }

  /**
   * A panel is disabled while its page is busy. When it becomes usable again it is the next expected scan.
   * A step reopened with Change is where the operator is about to scan, so it takes the cursor.
   */
  ngOnChanges(changes: SimpleChanges): void {
    const disabled = changes['disabled'];
    const done = changes['doneValue'];
    if (done && !done.firstChange && done.previousValue && !this.doneValue) {
      this.value = '';
      this.focus();
      return;
    }
    if (disabled && !disabled.firstChange && !this.disabled) this.claimFocus();
  }

  /**
   * Take the cursor when nothing else has it, or when it is still sitting in an earlier
   * scan step. Never take it from a field or button the operator chose (except a yielding one).
   */
  private claimFocus(): void {
    if (!this.autoFocus || this.disabled || this.doneValue) return;
    this.whenInputReady((input) => {
      const active = document.activeElement as HTMLElement | null;
      // Controls marked data-gear-yield-focus (the station's operation tabs) never keep a scan.
      const idle = !active || active === document.body || Boolean(active.closest('[data-gear-yield-focus]'));
      const earlierStep = Number(active?.dataset?.['gearScanStep']);
      if (idle || (Number.isFinite(earlierStep) && earlierStep < this.step)) {
        input.focus();
        input.select();
      }
    });
  }

  /**
   * Run after the current change-detection pass. ngModel applies [disabled] to the element
   * one microtask late, so a microtask here would still see a disabled input that cannot
   * take focus; a timer runs after both.
   */
  private whenInputReady(action: (input: HTMLInputElement) => void): void {
    setTimeout(() => {
      const input = this.input?.nativeElement;
      if (input && !input.disabled) action(input);
    });
  }

  submit() {
    const value = this.value.trim();
    if (!value || this.disabled) return;
    // Leave the scanned value visible but selected, so the next scan replaces it instead of appending to it.
    this.input?.nativeElement.select();
    this.scanned.emit(value);
  }

  /** A tap into the box selects what is there, so the next scan replaces an old value instead of appending to it. */
  selectOnFocus() {
    setTimeout(() => {
      const input = this.input?.nativeElement;
      if (input && document.activeElement === input) input.select();
    });
  }

  clearAndFocus() {
    this.value = '';
    this.whenInputReady((input) => input.focus());
  }

  select() {
    this.whenInputReady((input) => {
      input.focus();
      input.select();
    });
  }

  focus() {
    this.whenInputReady((input) => {
      input.focus();
      input.select();
    });
  }
}
