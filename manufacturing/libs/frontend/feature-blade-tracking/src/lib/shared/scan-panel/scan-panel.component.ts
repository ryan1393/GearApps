import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'gear-scan-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scan-panel.component.html',
})
export class ScanPanelComponent implements AfterViewInit, OnChanges {
  @Input() step = 1;
  @Input() label = 'Scan';
  @Input() help = '';
  @Input() placeholder = 'Scan barcode...';
  @Input() buttonText = 'Scan';
  @Input() disabled = false;
  @Input() autoFocus = true;
  @Output() scanned = new EventEmitter<string>();
  @ViewChild('input') input?: ElementRef<HTMLInputElement>;

  private static nextId = 1;
  readonly inputId = `gear-scan-${ScanPanelComponent.nextId++}`;

  value = '';

  ngAfterViewInit(): void {
    this.claimFocus();
  }

  /** A panel is disabled while its page is busy. When it becomes usable again it is the next expected scan. */
  ngOnChanges(changes: SimpleChanges): void {
    const disabled = changes['disabled'];
    if (disabled && !disabled.firstChange && !this.disabled) this.claimFocus();
  }

  /**
   * Take the cursor when nothing else has it, or when it is still sitting in an earlier
   * scan step. Never take it from a field or button the operator chose.
   */
  private claimFocus(): void {
    if (!this.autoFocus || this.disabled) return;
    this.whenInputReady((input) => {
      const active = document.activeElement as HTMLElement | null;
      const idle = !active || active === document.body;
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
