import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

let nextStepperId = 1;

/**
 * A whole-number field with large − and + buttons, so a count can be set on a touchscreen
 * without the on-screen keyboard. Typing still works. Use as [(value)].
 */
@Component({
  selector: 'gear-count-stepper',
  standalone: true,
  imports: [FormsModule],
  template: `
    <label class="stepper-label" [for]="inputId">{{ label }}</label>
    <div class="stepper">
      <button type="button" class="gear-btn gear-btn-secondary stepper-btn" [disabled]="disabled || value <= min"
        [attr.aria-label]="'Decrease ' + label" (click)="set(value - 1)">−</button>
      <input [id]="inputId" #field class="gear-input stepper-input" type="number" inputmode="numeric" [min]="min" [max]="max"
        [ngModel]="value" [ngModelOptions]="{ standalone: true }" (ngModelChange)="valueChange.emit($event)" [disabled]="disabled" (keydown.enter)="$event.preventDefault()" (focus)="field.select()" />
      <button type="button" class="gear-btn gear-btn-secondary stepper-btn" [disabled]="disabled || value >= max"
        [attr.aria-label]="'Increase ' + label" (click)="set(value + 1)">+</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .stepper-label { display: block; margin-bottom: var(--dana-space-1); }
    .stepper { display: grid; grid-template-columns: 64px minmax(80px, 1fr) 64px; gap: var(--dana-space-2); }
    .stepper-btn { min-height: 56px !important; }
    .stepper-input { min-height: 56px; }
  `],
})
export class CountStepperComponent {
  @Input() label = 'Count';
  @Input() value = 0;
  @Input() min = 0;
  @Input() max = 500;
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<number>();

  readonly inputId = `gear-count-stepper-${nextStepperId++}`;
  @ViewChild('field') private field?: ElementRef<HTMLInputElement>;

  /** The typed field, for callers that move the cursor here. */
  get input(): HTMLInputElement | undefined {
    return this.field?.nativeElement;
  }

  set(next: number): void {
    const current = Number.isFinite(next) ? Math.trunc(next) : this.min;
    this.valueChange.emit(Math.min(this.max, Math.max(this.min, current)));
  }
}
