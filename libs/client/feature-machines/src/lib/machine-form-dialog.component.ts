import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiErrorMessage, MachinesApi } from '@gearapps/client/core';
import { DialogComponent, SegmentedComponent } from '@gearapps/client/ui';
import { Machine, ScannerDetail } from '@gearapps/shared/domain';
import {
  IPV4_PATTERN,
  MACHINE_BUILDERS,
  MACHINE_CELLS,
  MACHINE_TYPES,
  STATUS_OPTIONS,
} from './machine-options';

@Component({
  selector: 'gear-machine-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="machine() ? 'Edit machine ' + (machine()?.number ?? '') : 'Add machine'"
      description="Asset details, cell assignment and the scanner attached to this lapper."
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="machineForm" class="gear-form-grid">
        <label class="gear-field">
          Asset ID
          <input class="gear-input" formControlName="number" placeholder="01-094-999" />
          @if (invalid('number')) {
            <small class="gear-field-help" role="alert">Asset ID is required.</small>
          }
        </label>
        <label class="gear-field">
          IP address
          <input
            class="gear-input"
            formControlName="ip"
            placeholder="10.16.80.174"
            inputmode="decimal"
          />
          @if (invalid('ip')) {
            <small class="gear-field-help" role="alert">Enter a valid IPv4 address.</small>
          }
        </label>
        <label class="gear-field dana-field-full"
          >Description
          <input class="gear-input" formControlName="description" placeholder="Lapper" />
        </label>
        <label class="gear-field">
          Department
          <select class="gear-select" formControlName="dept_id">
            <option [ngValue]="null" disabled>Choose a department</option>
            @for (d of departmentOptions(); track d.value) {
              <option [ngValue]="d.value">{{ d.label }}</option>
            }
          </select>
          @if (machine()) {
            <small class="gear-field-help">A machine keeps the department it was created in.</small>
          } @else if (invalid('dept_id')) {
            <small class="gear-field-help" role="alert"
              >Choose the GearApps department that owns this lapper.</small
            >
          }
        </label>
        <label class="gear-field"
          >Cell
          <input class="gear-input" formControlName="cell" list="gear-cells" placeholder="1" />
          <datalist id="gear-cells">
            @for (c of cells; track c) {
              <option [value]="c"></option>
            }
          </datalist>
        </label>
        <label class="gear-field"
          >Type
          <input class="gear-input" formControlName="type" list="gear-types" placeholder="L-60" />
          <datalist id="gear-types">
            @for (t of types; track t) {
              <option [value]="t"></option>
            }
          </datalist>
        </label>
        <label class="gear-field"
          >Builder
          <input
            class="gear-input"
            formControlName="builder"
            list="gear-builders"
            placeholder="Klingelnberg"
          />
          <datalist id="gear-builders">
            @for (b of builders; track b) {
              <option [value]="b"></option>
            }
          </datalist>
        </label>
        <label class="gear-field">
          Scanner
          <select class="gear-select" formControlName="scanner_id">
            <option [ngValue]="null">None</option>
            @for (s of scanners(); track s.id) {
              <option [ngValue]="s.id">{{ s.label }}</option>
            }
          </select>
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
          form="machineForm"
          class="gear-btn gear-btn-primary"
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Saving…' : machine() ? 'Save changes' : 'Add machine' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
})
export class MachineFormDialogComponent {
  private readonly api = inject(MachinesApi);

  readonly open = model(false);
  readonly machine = input<Machine | null>(null);
  readonly scannerOptions = input<ScannerDetail[]>([]);
  readonly departmentOptions = input<{ value: string; label: string }[]>([]);
  readonly saved = output<Machine>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly types = MACHINE_TYPES;
  protected readonly builders = MACHINE_BUILDERS;
  protected readonly cells = MACHINE_CELLS;
  protected readonly statuses = STATUS_OPTIONS.map((s) => ({ label: s, value: s }));
  protected readonly scanners = computed(() =>
    this.scannerOptions().map((s) => ({
      id: s.id,
      label: [s.ip, s.model, s.description].filter(Boolean).join(' · ') || s.id,
    })),
  );

  protected readonly form = new FormGroup({
    number: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ip: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(IPV4_PATTERN)],
    }),
    description: new FormControl<string | null>(null),
    dept_id: new FormControl<string | null>(null, { validators: [Validators.required] }),
    cell: new FormControl<string | null>(null),
    type: new FormControl<string | null>(null),
    builder: new FormControl<string | null>(null),
    scanner_id: new FormControl<string | null>(null),
    status: new FormControl('Active', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      const m = this.machine();
      const isOpen = this.open();
      untracked(() => {
        if (isOpen) this.patch(m);
        else this.error.set(null);
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
    const { number, dept_id, ...editable } = this.form.getRawValue();
    const existing = this.machine();
    // The API keeps a machine in the department it was created in, so edits never send it.
    const req = existing
      ? this.api.update(existing.id, editable)
      : this.api.create({ number, dept_id, ...editable });
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

  private patch(m: Machine | null) {
    this.form.reset({ status: 'Active' });
    this.form.controls.number.enable();
    this.form.controls.dept_id.enable();
    if (m) {
      const { id: _id, scanner: _scanner, ...rest } = m;
      this.form.patchValue({
        ...rest,
        number: m.number ?? '',
        scanner_id: m.scanner_id ?? m.scanner?.id ?? null,
      });
      this.form.controls.number.disable();
      this.form.controls.dept_id.disable();
    }
  }
}
