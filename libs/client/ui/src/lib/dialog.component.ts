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
 * General-purpose modal built on the native <dialog> with Dana's `.dana-dialog`
 * styling (Dana UI itself only ships a confirm dialog). Content goes in the body;
 * put buttons in an element with `dialogActions`.
 */
@Component({
  selector: 'gear-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dlg
      class="dana-dialog gear-dialog"
      [style.--dana-dialog-width]="width()"
      (cancel)="onCancel($event)"
      (mousedown)="onBackdrop($event)"
    >
      <div class="dana-dialog-header">
        <h2>{{ title() }}</h2>
        @if (description()) {
          <p>{{ description() }}</p>
        }
      </div>
      <div class="dana-dialog-body"><ng-content /></div>
      <div class="dana-dialog-actions"><ng-content select="[dialogActions]" /></div>
    </dialog>
  `,
  styles: `
    .gear-dialog {
      padding: 0;
    }
    .gear-dialog:not([open]) {
      display: none;
    }
    .gear-dialog::backdrop {
      background: rgba(15, 31, 54, 0.46);
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
