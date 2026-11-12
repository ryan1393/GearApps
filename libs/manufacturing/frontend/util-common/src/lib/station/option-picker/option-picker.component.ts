import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

export interface PickerOption {
  /** What is passed back when the row is chosen: usually the serial number, as if it had been scanned. */
  value: string;
  /** The row's columns; the first one is shown in bold. */
  cells: readonly (string | number)[];
}

let nextPickerId = 1;

/**
 * The "or choose from the list" fallback beside every scan step. One look and one size everywhere:
 * the list opens in place (never floating off-screen), and every row is a large touch target.
 * Choosing a row closes the list and emits its value.
 */
@Component({
  selector: 'gear-option-picker',
  standalone: true,
  host: { '[style.--picker-columns]': 'columns', '[class.picker-plain]': '!divider' },
  template: `
    @if (divider) { <div class="picker-divider" aria-hidden="true">OR</div> }
    <button #toggle type="button" class="gear-input picker-toggle" [attr.aria-expanded]="open && !disabled" [attr.aria-controls]="open && !disabled ? listId : null"
      [disabled]="disabled" (click)="open = !open" (keydown.escape)="open && close($event)">
      <span>{{ placeholder }}</span>
      <span class="picker-count">{{ loading ? 'Loading…' : options.length }}</span>
      <span aria-hidden="true">{{ open ? '⌃' : '⌄' }}</span>
    </button>
    @if (open && !disabled) {
      <div class="picker-list" [id]="listId" role="list" [attr.aria-label]="placeholder" [attr.aria-busy]="loading" (keydown.escape)="close($event)">
        @if (headers.length) {
          <div class="picker-row picker-head" aria-hidden="true">
            @for (header of headers; track $index) { <span>{{ header }}</span> }
          </div>
        }
        @for (option of options; track option.value) {
          <div role="listitem"><button type="button" class="picker-row" [disabled]="loading || !!error" (click)="choose(option.value)">
              @for (cell of option.cells; track $index) { <span>{{ cell }}</span> }
          </button></div>
        }
        @if (loading) { <p class="picker-note" role="status">Loading…</p> }
        @if (error) { <p class="picker-note picker-error" role="alert">{{ error }}</p> }
        @if (!loading && !error && !options.length) { <p class="picker-note">{{ emptyText }}</p> }
      </div>
    }
  `,
  styles: [`
    :host { display: block; margin-top: var(--dana-space-4); padding-top: var(--dana-workstation-gap); }
    :host(.picker-plain) { margin-top: 0; padding-top: 0; }
    .picker-divider { margin-bottom: var(--dana-space-2); }
    .picker-toggle { display: flex; align-items: center; gap: var(--dana-workstation-gap); width: 100%; min-height: 56px; }
    .picker-toggle > span:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .picker-count { min-width: 2rem; padding: 2px var(--dana-space-2); }
    .picker-list { margin-top: 6px; max-height: 300px; overflow: auto; overscroll-behavior: contain; }
    .picker-row { display: grid; grid-template-columns: var(--picker-columns); align-items: center; gap: var(--dana-workstation-gap); width: 100%; min-height: 56px; padding: var(--dana-space-2) var(--dana-space-4); touch-action: manipulation; }
    .picker-row > span { min-width: 0; overflow-wrap: anywhere; }
    .picker-head { position: sticky; top: 0; min-height: 0; padding-block: var(--dana-space-2); }
    .picker-note { margin: 0; padding: var(--dana-workstation-gap) var(--dana-space-4); }
  `],
})
export class OptionPickerComponent {
  @Input() placeholder = 'Choose…';
  @Input() headers: readonly string[] = [];
  @Input() options: readonly PickerOption[] = [];
  @Input() loading = false;
  @Input() error = '';
  @Input() emptyText = 'Nothing is available right now.';
  @Input() disabled = false;
  /** Show the "OR" divider that separates the list from the scan box above it. */
  @Input() divider = true;
  @Output() picked = new EventEmitter<string>();

  /** The first column is the identifier and gets the most room. */
  get columns(): string {
    const count = Math.max(this.headers.length, ...this.options.map((option) => option.cells.length), 1);
    return count === 1 ? 'minmax(0, 1fr)' : `minmax(0, 2fr) repeat(${count - 1}, minmax(0, 1fr))`;
  }

  readonly listId = `gear-option-picker-${nextPickerId++}`;
  @ViewChild('toggle') toggle?: ElementRef<HTMLButtonElement>;
  open = false;

  close(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.open = false;
    this.toggle?.nativeElement.focus();
  }

  choose(value: string): void {
    if (this.disabled || this.loading || this.error) return;
    this.close();
    this.picked.emit(value);
  }
}
