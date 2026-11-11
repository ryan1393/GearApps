import { Component, EventEmitter, Input, Output } from '@angular/core';

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
    <button type="button" class="gear-input picker-toggle" [attr.aria-expanded]="open" [attr.aria-controls]="listId"
      [disabled]="disabled" (click)="open = !open">
      <span>{{ placeholder }}</span>
      <span class="picker-count">{{ loading ? 'Loading…' : options.length }}</span>
      <span aria-hidden="true">{{ open ? '⌃' : '⌄' }}</span>
    </button>
    @if (open && !disabled) {
      <div class="picker-list" [id]="listId" role="list">
        @if (headers.length) {
          <div class="picker-row picker-head" aria-hidden="true">
            @for (header of headers; track $index) { <span>{{ header }}</span> }
          </div>
        }
        @for (option of options; track option.value) {
          <button type="button" role="listitem" class="picker-row" (click)="choose(option.value)">
            @for (cell of option.cells; track $index) { <span>{{ cell }}</span> }
          </button>
        }
        @if (loading) { <p class="picker-note" role="status">Loading…</p> }
        @if (error) { <p class="picker-note picker-error" role="alert">{{ error }}</p> }
        @if (!loading && !error && !options.length) { <p class="picker-note">{{ emptyText }}</p> }
      </div>
    }
  `,
  styles: [`
    :host { display: block; margin-top: 16px; border-top: 1px solid var(--dana-border); padding-top: 12px; }
    :host(.picker-plain) { margin-top: 0; border-top: 0; padding-top: 0; }
    .picker-divider { margin-bottom: 8px; text-align: center; font-size: .75rem; font-weight: 900; letter-spacing: .08em; color: var(--dana-muted); }
    .picker-toggle { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; cursor: pointer; text-align: left; font-size: 1.05rem; }
    .picker-toggle > span:first-child { flex: 1; }
    .picker-count { min-width: 2rem; padding: 2px 8px; border-radius: 999px; background: var(--dana-neutral-soft); text-align: center; font-size: .85rem; font-weight: 800; }
    .picker-list { margin-top: 6px; max-height: 300px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--dana-border); border-radius: 12px; background: var(--dana-surface); }
    .picker-row { display: grid; grid-template-columns: var(--picker-columns); align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 8px 16px; border: 0; border-bottom: 1px solid var(--dana-border);
      background: none; color: var(--dana-text); font: inherit; text-align: left; cursor: pointer; touch-action: manipulation; }
    .picker-row > span:first-child { font-weight: 800; }
    .picker-row > span:last-child:not(:first-child) { text-align: right; }
    button.picker-row:hover, button.picker-row:focus-visible { background: var(--dana-neutral-soft); }
    .picker-head { position: sticky; top: 0; min-height: 0; padding-block: 8px; background: var(--dana-neutral-soft); cursor: default;
      font-size: .75rem; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: var(--dana-muted); }
    .picker-head > span:first-child { font-weight: 900; }
    .picker-note { margin: 0; padding: 12px 16px; font-size: .95rem; }
    .picker-error { color: var(--dana-danger); }
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
  open = false;

  choose(value: string): void {
    this.open = false;
    this.picked.emit(value);
  }
}
