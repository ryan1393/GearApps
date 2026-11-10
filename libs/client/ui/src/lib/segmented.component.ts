import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface SegmentOption<T = string> {
  label: string;
  value: T;
}

/** Small choice group built from Gear Apps buttons, usable with reactive forms / ngModel. */
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
          [disabled]="disabled()"
          (click)="pick(o.value)"
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
    this.value.set(v);
    this.onChange(v);
    this.onTouched();
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
