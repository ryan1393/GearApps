import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, Output, ViewChild, forwardRef,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** One column in the dropdown list. `value` returns the text shown in that cell. */
export interface DanaComboboxColumn<T = any> {
  label: string;
  value: (row: T) => string | number | null | undefined;
  /** CSS grid track, for example '1.4fr' or '120px'. Defaults to '1fr'. */
  width?: string;
  /** Right-align numbers and times. */
  align?: 'start' | 'end';
}

let nextId = 0;

/**
 * Searchable dropdown that lists rows under column headers.
 *
 * - Pick mode (default): the bound value is the chosen row's key; typing only filters.
 * - Free-text mode (`freeText`): the bound value is the typed text; rows are suggestions,
 *   and choosing one fills in the text from `textOf` and emits `picked`.
 *
 * Keyboard: Down/Up move, Enter picks, Escape closes, Home/End jump. Works with ngModel
 * and reactive forms.
 */
@Component({
  selector: 'dana-combobox',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DanaComboboxComponent), multi: true }],
  host: { class: 'dana-combobox', '[class.is-open]': 'open', '[class.is-disabled]': 'disabled' },
  template: `
    <div class="dana-combobox-control">
      <input
        #input
        class="dana-combobox-input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        [id]="inputId"
        [attr.aria-label]="ariaLabel || null"
        [attr.aria-expanded]="open"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="open && activeIndex >= 0 ? optionId(activeIndex) : null"
        aria-autocomplete="list"
        [placeholder]="placeholder"
        [disabled]="disabled"
        [value]="inputText"
        (input)="onInput($any($event.target).value)"
        (focus)="onFocus()"
        (click)="openList()"
        (keydown)="onKeydown($event)"
        (blur)="onBlur()">
      @if (!freeText && selectedKey && !disabled) {
        <button type="button" class="dana-combobox-clear" tabindex="-1" aria-label="Clear" (mousedown)="$event.preventDefault()" (click)="clear()">&times;</button>
      }
      <button type="button" class="dana-combobox-toggle" tabindex="-1" [attr.aria-label]="open ? 'Close list' : 'Open list'"
        [disabled]="disabled" (mousedown)="$event.preventDefault()" (click)="open ? close() : openList(true)">
        <span aria-hidden="true"></span>
      </button>
    </div>
    @if (open) {
      <div class="dana-combobox-panel" [class.is-above]="placement.above" [style.--dana-combobox-columns]="gridTemplate"
        [style.top.px]="placement.top" [style.bottom.px]="placement.bottom" [style.left.px]="placement.left" [style.width.px]="placement.width"
        [style.--dana-combobox-list-max]="placement.listMax + 'px'">
        <div class="dana-combobox-head" aria-hidden="true">
          @for (column of columns; track column.label) {
            <span [class.is-end]="column.align === 'end'">{{ column.label }}</span>
          }
        </div>
        <ul class="dana-combobox-list" role="listbox" [id]="listId" [attr.aria-label]="ariaLabel || placeholder">
          @for (row of filtered; track keyOf(row); let i = $index) {
            <li
              class="dana-combobox-option"
              role="option"
              [id]="optionId(i)"
              [class.is-active]="i === activeIndex"
              [class.is-selected]="!freeText && keyOf(row) === selectedKey"
              [attr.aria-selected]="!freeText && keyOf(row) === selectedKey"
              [attr.aria-label]="describe(row)"
              (mousedown)="$event.preventDefault()"
              (mouseenter)="activeIndex = i"
              (click)="pick(row)">
              @for (column of columns; track column.label) {
                <span [class.is-end]="column.align === 'end'">{{ cell(column, row) }}</span>
              }
            </li>
          } @empty {
            <li class="dana-combobox-empty" role="presentation">{{ loading ? loadingText : emptyText }}</li>
          }
        </ul>
        @if (filtered.length > maxRows && query) {
          <div class="dana-combobox-foot" aria-live="polite">{{ filtered.length }} matches</div>
        }
      </div>
    }
  `,
})
export class DanaComboboxComponent<T = any> implements ControlValueAccessor, OnChanges, OnDestroy {
  @Input() options: readonly T[] = [];
  @Input() columns: DanaComboboxColumn<T>[] = [];
  /** Stable key for a row (pick mode binds to this). */
  @Input() keyOf: (row: T) => string = (row) => String(row);
  /** Text put in the box when a row is chosen. Defaults to the first column. */
  @Input() textOf?: (row: T) => string;
  @Input() freeText = false;
  @Input() placeholder = 'Select…';
  @Input() ariaLabel = '';
  @Input() emptyText = 'No matches';
  @Input() loading = false;
  @Input() loadingText = 'Loading…';
  /** Rows visible before the list scrolls. */
  @Input() maxRows = 8;
  private disabledValue = false;
  @Input() get disabled(): boolean { return this.disabledValue; }
  set disabled(value: boolean) {
    this.disabledValue = value;
    if (value) {
      this.close();
      if (!this.freeText) { this.inputText = this.labelFor(this.selectedKey); this.query = ''; }
    }
  }
  /** Upper-case typed text (load numbers, trailer IDs). */
  @Input() uppercase = false;
  @Output() readonly picked = new EventEmitter<T | null>();
  @Output() readonly textChange = new EventEmitter<string>();

  @ViewChild('input', { static: true }) private inputRef!: ElementRef<HTMLInputElement>;

  readonly inputId = `dana-combobox-${++nextId}`;
  readonly listId = `${this.inputId}-list`;
  open = false;
  query = '';
  inputText = '';
  selectedKey = '';
  activeIndex = -1;
  filtered: T[] = [];
  /** Fixed-position placement so a panel or table that clips overflow cannot cut the list off. */
  placement: { top: number | null; bottom: number | null; left: number; width: number; listMax: number; above: boolean } =
    { top: null, bottom: null, left: 0, width: 0, listMax: 336, above: false };

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  /** Document/window listeners exist only while the list is open. */
  private openCleanup?: () => void;
  private destroyed = false;

  constructor(private readonly host: ElementRef<HTMLElement>, private readonly cdr: ChangeDetectorRef) {}

  get gridTemplate(): string {
    return this.columns.map((column) => column.width || '1fr').join(' ');
  }

  ngOnChanges(): void {
    // New options while the list is open must not overwrite what the user is typing.
    if (!this.freeText && !this.open) this.inputText = this.labelFor(this.selectedKey);
    this.refilter();
  }

  // ControlValueAccessor
  writeValue(value: unknown): void {
    const text = value == null ? '' : String(value);
    if (this.freeText) { this.inputText = text; this.query = ''; }
    else { this.selectedKey = text; this.inputText = this.labelFor(text); this.query = ''; }
    this.refilter();
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled = disabled; this.cdr.markForCheck(); }

  cell(column: DanaComboboxColumn<T>, row: T): string {
    const value = column.value(row);
    return value == null || value === '' ? '—' : String(value);
  }
  describe(row: T): string {
    return this.columns.map((column) => `${column.label}: ${this.cell(column, row)}`).join(', ');
  }
  optionId(index: number): string { return `${this.inputId}-option-${index}`; }

  onFocus(): void { this.openList(); }

  onInput(raw: string): void {
    if (this.disabled) return;
    const text = this.uppercase ? raw.toUpperCase() : raw;
    if (text !== raw) this.inputRef.nativeElement.value = text;
    this.inputText = text;
    this.query = text;
    if (this.freeText) { this.onChange(text); this.textChange.emit(text); }
    else if (!text && this.selectedKey) { this.selectedKey = ''; this.onChange(''); this.picked.emit(null); }
    if (!this.open) this.openList();
    this.refilter();
    this.activeIndex = this.filtered.length ? 0 : -1;
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.disabled) return;
    const last = this.filtered.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open) { this.openList(true); return; }
        this.move(Math.min(last, this.activeIndex + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open) { this.openList(true); return; }
        this.move(Math.max(0, this.activeIndex - 1));
        break;
      case 'Home':
        if (this.open && this.filtered.length) { event.preventDefault(); this.move(0); }
        break;
      case 'End':
        if (this.open && this.filtered.length) { event.preventDefault(); this.move(last); }
        break;
      case 'Enter':
        // An unfinished pick-mode search must not submit a form with a stale selection.
        if (this.open && !this.freeText) event.preventDefault();
        if (this.open && this.activeIndex >= 0 && this.filtered[this.activeIndex]) {
          event.preventDefault();
          this.pick(this.filtered[this.activeIndex]);
        }
        break;
      case 'Escape':
        if (this.open) {
          event.preventDefault();
          event.stopPropagation();
          if (!this.freeText) { this.inputText = this.labelFor(this.selectedKey); this.query = ''; }
          this.close();
        }
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  onBlur(): void {
    this.onTouched();
    // Pick mode never keeps half-typed text: show the chosen row again.
    if (!this.freeText) { this.inputText = this.labelFor(this.selectedKey); this.query = ''; }
    this.close();
  }

  openList(showAll = false): void {
    if (this.disabled || this.open) return;
    if (showAll) this.query = '';
    this.open = true;
    const document = this.host.nativeElement.ownerDocument;
    const view = document.defaultView;
    const reposition = () => this.onViewportChange();
    const outside = (event: MouseEvent) => this.onDocumentMouseDown(event);
    // Scroll events from overflow panels do not bubble to the window.
    document.addEventListener('scroll', reposition, true);
    document.addEventListener('mousedown', outside);
    view?.addEventListener('resize', reposition);
    this.openCleanup = () => {
      document.removeEventListener('scroll', reposition, true);
      document.removeEventListener('mousedown', outside);
      view?.removeEventListener('resize', reposition);
    };
    this.place();
    this.refilter();
    const selected = this.filtered.findIndex((row) => !this.freeText && this.keyOf(row) === this.selectedKey);
    this.activeIndex = selected >= 0 ? selected : (this.filtered.length ? 0 : -1);
    this.cdr.markForCheck();
    this.scrollActive();
  }

  close(): void {
    this.openCleanup?.();
    this.openCleanup = undefined;
    if (!this.open) return;
    this.open = false;
    this.activeIndex = -1;
    this.cdr.markForCheck();
  }

  clear(): void {
    if (this.disabled) return;
    this.selectedKey = '';
    this.inputText = '';
    this.query = '';
    this.onChange('');
    this.picked.emit(null);
    this.refilter();
    this.inputRef.nativeElement.focus();
  }

  pick(row: T): void {
    if (this.disabled) return;
    const key = this.keyOf(row);
    if (this.freeText) {
      this.inputText = this.textFor(row);
      this.onChange(this.inputText);
      this.textChange.emit(this.inputText);
    } else {
      this.selectedKey = key;
      this.inputText = this.textFor(row);
      this.onChange(key);
    }
    this.query = '';
    this.picked.emit(row);
    this.close();
    this.refilter();
  }

  onViewportChange(): void {
    if (!this.open) return;
    this.place();
    this.cdr.markForCheck();
  }

  /** Below the input when there is room, otherwise above; never wider than the viewport. */
  private place(): void {
    if (typeof window === 'undefined') return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    const gap = 6, edge = 16;
    const preferred = parseFloat(getComputedStyle(this.host.nativeElement).getPropertyValue('--dana-combobox-panel-width')) || 680;
    const width = Math.min(Math.max(rect.width, preferred), window.innerWidth - edge * 2);
    const left = Math.min(Math.max(edge, rect.left), window.innerWidth - edge - width);
    const below = window.innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const header = 36, foot = 8, rows = 42 * Math.min(Math.max(this.maxRows, 1), 8);
    const openAbove = below < Math.min(rows, 220) && above > below;
    const room = Math.max(120, (openAbove ? above : below) - header - foot);
    this.placement = {
      top: openAbove ? null : rect.bottom + gap,
      bottom: openAbove ? window.innerHeight - rect.top + gap : null,
      left, width, listMax: Math.min(rows, room), above: openAbove,
    };
  }

  onDocumentMouseDown(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.openCleanup?.();
    this.openCleanup = undefined;
  }

  private move(index: number): void {
    this.activeIndex = this.filtered.length ? Math.max(0, Math.min(index, this.filtered.length - 1)) : -1;
    this.cdr.markForCheck();
    this.scrollActive();
  }

  private scrollActive(): void {
    queueMicrotask(() => {
      if (this.destroyed || !this.open) return;
      const el = this.host.nativeElement.querySelector<HTMLElement>(`#${this.optionId(this.activeIndex)}`);
      el?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  private refilter(): void {
    const terms = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = [...(this.options ?? [])];
    this.filtered = terms.length
      ? rows.filter((row) => {
          const haystack = this.columns.map((column) => this.cell(column, row)).join(' ').toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
      : rows;
    if (this.activeIndex >= this.filtered.length) this.activeIndex = this.filtered.length - 1;
  }

  private textFor(row: T): string {
    if (this.textOf) return this.textOf(row);
    const first = this.columns[0];
    return first ? String(first.value(row) ?? '') : this.keyOf(row);
  }

  private labelFor(key: string): string {
    if (!key) return '';
    const row = (this.options ?? []).find((candidate) => this.keyOf(candidate) === key);
    return row ? this.textFor(row) : key;
  }
}
