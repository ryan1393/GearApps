import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiErrorMessage, MacrosApi } from '@meshforge/client/core';
import { DialogComponent, SegmentedComponent } from '@meshforge/client/ui';
import { Macro } from '@meshforge/shared/domain';
import { MACRO_FORM_OPTIONS, MACRO_STATUS_OPTIONS, MACRO_TYPES } from './options';

@Component({
  selector: 'gear-macro-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="macro() ? 'Edit macro #' + macro()?.number : 'Add macro'"
      description="A Fanuc macro variable the lapper reports each cycle, and where it belongs on the lapping summary."
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="macroForm" class="gear-form-grid">
        <label class="gear-field">
          Macro number
          <input
            class="gear-input"
            type="number"
            step="1"
            min="1"
            formControlName="number"
            placeholder="10032"
          />
          @if (invalid('number')) {
            <small class="gear-field-help" role="alert"
              >Enter the whole Fanuc macro number, e.g. 10032.</small
            >
          }
        </label>
        <label class="gear-field">
          Name
          <input class="gear-input" formControlName="name" placeholder="consec_no" />
          <small class="gear-field-help"
            >Path macros are matched by name, e.g. coast_heel_rpm.</small
          >
        </label>
        <label class="gear-field">
          Summary form
          <select class="gear-select" formControlName="used_form">
            <option [ngValue]="null">Not on the summary</option>
            @for (f of forms; track f.value) {
              <option [ngValue]="f.value">{{ f.label }}</option>
            }
          </select>
        </label>
        <label class="gear-field">
          Tab index
          <input class="gear-input" type="number" step="1" min="0" formControlName="tab_index" />
        </label>
        <label class="gear-field">
          Value type
          <select class="gear-select" formControlName="type">
            @for (t of types; track t) {
              <option [ngValue]="t">{{ t }}</option>
            }
          </select>
        </label>
        <label class="gear-field">
          L60 table
          <input class="gear-input" formControlName="l60_table" placeholder="L60" />
        </label>
        <label class="gear-field dana-field-full">
          Extra
          <input
            class="gear-input"
            formControlName="extra"
            placeholder="Optional note or legacy column"
          />
        </label>
        <div class="gear-field">
          <span>Status</span>
          <gear-segmented formControlName="status" [options]="statuses" ariaLabel="Status" />
        </div>
        @if (error()) {
          <p class="gear-alert gear-alert-danger dana-field-full" role="alert">{{ error() }}</p>
        }
      </form>
      <ng-container dialogActions>
        <button type="button" class="gear-btn gear-btn-secondary" (click)="open.set(false)">
          Cancel
        </button>
        <button
          type="submit"
          form="macroForm"
          class="gear-btn gear-btn-primary"
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Saving…' : macro() ? 'Save changes' : 'Add macro' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
})
export class MacroFormDialogComponent {
  private readonly api = inject(MacrosApi);

  readonly open = model(false);
  readonly macro = input<Macro | null>(null);
  /** Pre-selects the form group when adding from a filtered list. */
  readonly defaultForm = input<string | null>(null);
  readonly saved = output<Macro>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly forms = MACRO_FORM_OPTIONS;
  protected readonly types = MACRO_TYPES;
  protected readonly statuses = MACRO_STATUS_OPTIONS;

  protected readonly form = new FormGroup({
    number: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(1),
      Validators.pattern(/^\d+$/),
    ]),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    used_form: new FormControl<string | null>(null),
    tab_index: new FormControl<number | null>(null, [Validators.min(0)]),
    type: new FormControl('real', { nonNullable: true, validators: [Validators.required] }),
    l60_table: new FormControl('L60', { nonNullable: true, validators: [Validators.required] }),
    extra: new FormControl<string | null>(null),
    status: new FormControl<number>(1, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const m = this.macro();
      const isOpen = this.open();
      untracked(() => {
        this.error.set(null);
        if (!isOpen) return;
        this.form.reset({
          type: 'real',
          l60_table: 'L60',
          status: 1,
          used_form: this.defaultForm(),
        });
        if (m) {
          this.form.patchValue({ ...m, status: m.status ?? 0 });
        }
      });
    });
  }

  protected invalid(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected save() {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const body = {
      ...v,
      number: Number(v.number),
      name: v.name.trim(),
      tab_index:
        v.tab_index === null || (v.tab_index as unknown) === '' ? null : Number(v.tab_index),
      extra: v.extra?.trim() ? v.extra.trim() : null,
    };
    const existing = this.macro();
    const req = existing ? this.api.update(existing.id, body) : this.api.create(body);
    req.subscribe({
      next: (m) => {
        this.busy.set(false);
        this.saved.emit(m);
        this.open.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
