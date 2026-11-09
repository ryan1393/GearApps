import { CommonModule } from '@angular/common';
import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, Output, ViewChild,
} from '@angular/core';

let nextDialogId = 0;

@Component({
  selector: 'dana-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dana-confirm-dialog" role="alertdialog" aria-modal="true"
      [attr.aria-label]="title" [attr.aria-describedby]="message ? messageId : null" (cancel)="onCancel($event)" (close)="onClose()"
      (click)="onBackdropClick($event)">
      <h2>{{ title }}</h2>
      <p [id]="messageId">{{ message }}</p>
      <ng-content></ng-content>
      <div class="dana-dialog-actions">
        <button #cancelButton type="button" class="dana-btn dana-btn-secondary" (click)="cancel.emit()">{{ cancelLabel }}</button>
        <button type="button" class="dana-btn" [class.dana-btn-danger]="danger"
          [class.dana-btn-primary]="!danger" (click)="confirm.emit()">{{ confirmLabel }}</button>
      </div>
    </dialog>
  `,
})
export class DanaConfirmDialogComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() open = false;
  @Input() title = 'Confirm';
  @Input() message = '';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() danger = false;
  @Output() readonly confirm = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();
  @ViewChild('dialog', { static: true }) private dialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('cancelButton', { static: true }) private cancelButton?: ElementRef<HTMLButtonElement>;
  readonly messageId = `dana-dialog-message-${++nextDialogId}`;
  private previouslyFocused?: HTMLElement;
  private destroyed = false;

  ngOnChanges(): void { this.syncOpen(); }
  ngAfterViewInit(): void { this.syncOpen(); }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.close();
  }

  onCancel(event: Event): void {
    // The parent owns `open`, as it does for the action buttons.
    event.preventDefault();
    this.cancel.emit();
  }

  onClose(): void {
    if (!this.destroyed && this.open && !this.dialogRef?.nativeElement.open) this.cancel.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog || event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) this.cancel.emit();
  }

  private syncOpen(): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog || typeof dialog.showModal !== 'function') return;
    if (this.open && !dialog.open) {
      this.previouslyFocused = dialog.ownerDocument.activeElement as HTMLElement | undefined;
      // Native modality makes the background inert and contains keyboard focus.
      dialog.showModal();
      this.cancelButton?.nativeElement.focus();
    } else if (!this.open) this.close();
  }

  private close(): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog?.open) return;
    dialog.close();
    if (this.previouslyFocused?.isConnected) this.previouslyFocused.focus();
    this.previouslyFocused = undefined;
  }
}
