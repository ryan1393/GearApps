import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'gear-scan-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scan-panel.component.html',
})
export class ScanPanelComponent implements AfterViewInit {
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
    if (!this.autoFocus || this.disabled) return;
    queueMicrotask(() => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? '';
      const operatorIsEditing = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag);
      if (!operatorIsEditing) this.input?.nativeElement.focus();
    });
  }

  submit() {
    const value = this.value.trim();
    if (!value || this.disabled) return;
    this.scanned.emit(value);
  }

  clearAndFocus() {
    this.value = '';
    queueMicrotask(() => this.input?.nativeElement.focus());
  }

  select() {
    queueMicrotask(() => this.input?.nativeElement.select());
  }

  focus() {
    queueMicrotask(() => this.input?.nativeElement.focus());
  }
}
