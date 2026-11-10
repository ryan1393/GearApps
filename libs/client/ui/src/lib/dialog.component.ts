import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  model,
  viewChild,
} from '@angular/core';

/**
 * General-purpose modal on the native <dialog>, dressed in Dana's confirm-dialog
 * surface so forms match every other Gear Apps dialog. Content goes in the body;
 * put buttons in an element with `dialogActions`.
 */
@Component({
  selector: 'gear-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dlg
      class="dana-confirm-dialog gear-dialog"
      aria-modal="true"
      [attr.aria-label]="title()"
      [style.width]="'min(' + width() + ', 100%)'"
      (cancel)="onCancel($event)"
      (mousedown)="onBackdrop($event)"
    >
      <h2>{{ title() }}</h2>
      @if (description()) {
        <p>{{ description() }}</p>
      }
      <div class="gear-dialog-body"><ng-content /></div>
      <div class="dana-dialog-actions"><ng-content select="[dialogActions]" /></div>
    </dialog>
  `,
  styles: `
    .gear-dialog:not([open]) {
      display: none;
    }
    .gear-dialog-body {
      margin-top: 18px;
    }
  `,
})
export class DialogComponent {
  readonly open = model(false);
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly width = input('640px');
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.open() && !el.open) el.showModal();
      else if (!this.open() && el.open) el.close();
    });
  }

  protected onCancel(event: Event) {
    event.preventDefault();
    this.open.set(false);
  }

  protected onBackdrop(event: MouseEvent) {
    const el = this.dlg().nativeElement;
    if (event.target !== el) return;
    const r = el.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    ) {
      this.open.set(false);
    }
  }
}
