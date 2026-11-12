import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface SegmentOption<T = string> {
  label: string;
  value: T;
}

/** Small choice group built from MeshForge buttons, usable with reactive forms / ngModel. */
@Component({
  selector: 'gear-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .gear-segmented {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .gear-segmented > button {
      flex: 1 1 0;
      min-width: 72px;
    }
  `,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SegmentedComponent), multi: true },
  ],
  template: `
    <div class="gear-segmented" role="radiogroup" [attr.aria-label]="ariaLabel()">
      @for (o of options(); track o.value) {
        <button
          type="button"
          role="radio"
          class="gear-btn"
          [class.gear-btn-primary]="o.value === value()"
          [class.gear-btn-secondary]="o.value !== value()"
          [attr.aria-checked]="o.value === value()"
          [attr.tabindex]="tabIndex($index)"
          [disabled]="disabled()"
          (click)="pick(o.value)"
          (keydown)="onKeydown($event, $index)"
        >
          {{ o.label }}
        </button>
      }
    </div>
  `,
})
export class SegmentedComponent<T = string> implements ControlValueAccessor {
  readonly options = input.required<SegmentOption<T>[]>();
  readonly ariaLabel = input<string>();
  protected readonly value = signal<T | null>(null);
  protected readonly disabled = signal(false);
  private onChange: (v: T) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected pick(v: T) {
    if (this.disabled()) return;
    this.value.set(v);
    this.onChange(v);
    this.onTouched();
  }
  protected tabIndex(index: number): number {
    const selected = this.options().findIndex(option => option.value === this.value());
    return index === (selected < 0 ? 0 : selected) ? 0 : -1;
  }
  protected onKeydown(event: KeyboardEvent, index: number): void {
    if (this.disabled()) return;
    const options = this.options();
    if (!options.length) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': next = (index + 1) % options.length; break;
      case 'ArrowLeft': case 'ArrowUp': next = (index - 1 + options.length) % options.length; break;
      case 'Home': next = 0; break;
      case 'End': next = options.length - 1; break;
      default: return;
    }
    event.preventDefault();
    this.pick(options[next].value);
    const button = event.currentTarget as HTMLButtonElement;
    button.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }
  writeValue(v: T | null) {
    this.value.set(v);
  }
  registerOnChange(fn: (v: T) => void) {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean) {
    this.disabled.set(d);
  }
}
