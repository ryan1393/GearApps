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
import { apiErrorMessage, ScannerDetailsApi } from '@meshforge/client/core';
import { DialogComponent, SegmentedComponent } from '@meshforge/client/ui';
import { Machine, ScannerDetail } from '@meshforge/shared/domain';
import { IPV4_PATTERN, SCANNER_TYPES, STATUS_OPTIONS } from './options';

@Component({
  selector: 'gear-scanner-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      [dismissible]="!busy()"
      (openChange)="open.set($event)"
      [title]="scanner() ? 'Edit scanner ' + (scanner()?.ip ?? '') : 'Add scanner'"
      description="Network address, the lapper it reads parts for, and the serial numbers it last reported."
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="scannerForm" class="gear-form-grid">
        <label class="gear-field">
          IP address
          <input
            class="gear-input"
            formControlName="ip"
            placeholder="10.16.80.68"
            inputmode="decimal"
          />
          @if (invalid('ip')) {
            <small class="gear-field-help" role="alert">Enter a valid IPv4 address.</small>
          }
        </label>
        <label class="gear-field">
          Model
          <input class="gear-input" formControlName="model" placeholder="SR-2000" />
        </label>
        <label class="gear-field">
          Type
          <input
            class="gear-input"
            formControlName="type"
            list="gear-scanner-types"
            placeholder="Barcode"
          />
          <datalist id="gear-scanner-types">
            @for (t of types; track t) {
              <option [value]="t"></option>
            }
          </datalist>
        </label>
        <label class="gear-field">
          Machine
          <select class="gear-select" formControlName="machine_id">
            <option [ngValue]="null">Not assigned</option>
            @for (m of machineOptions(); track m.id) {
              <option [ngValue]="m.id" [disabled]="m.taken">{{ m.label }}</option>
            }
          </select>
          <small class="gear-field-help"
            >A machine has one scanner; unassign the other one first.</small
          >
        </label>
        <label class="gear-field dana-field-full">
          Description
          <input class="gear-input" formControlName="description" placeholder="Cell 1 scanner" />
        </label>
        <label class="gear-field">
          In scanner
          <input class="gear-input" formControlName="sn_scanner" />
        </label>
        <label class="gear-field">
          In queue
          <input class="gear-input" formControlName="sn_queue" />
        </label>
        <label class="gear-field">
          In process
          <input class="gear-input" formControlName="sn_procces" />
          <small class="gear-field-help"
            >Serial numbers are normally written by the scanner collector.</small
          >
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
        <button type="button" class="gear-btn gear-btn-secondary" (click)="open.set(false)" [disabled]="busy()">
          Cancel
        </button>
        <button
          type="submit"
          form="scannerForm"
          class="gear-btn gear-btn-primary"
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Saving…' : scanner() ? 'Save changes' : 'Add scanner' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
})
export class ScannerFormDialogComponent {
  private readonly api = inject(ScannerDetailsApi);

  readonly open = model(false);
  readonly scanner = input<ScannerDetail | null>(null);
  readonly machines = input<Machine[]>([]);
  readonly scanners = input<ScannerDetail[]>([]);
  readonly saved = output<ScannerDetail>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly types = SCANNER_TYPES;
  protected readonly statuses = STATUS_OPTIONS;

  /** Machines; ones another scanner already reads for can't be chosen (the API allows one each). */
  protected readonly machineOptions = computed(() => {
    const self = this.scanner()?.id;
    return [...this.machines()]
      .sort((a, b) => (a.number ?? a.ip).localeCompare(b.number ?? b.ip))
      .map((m) => {
        const other = this.scanners().find((s) => s.machine_id === m.id && s.id !== self);
        const name = `${m.number ?? m.ip}${m.cell ? ` · Cell ${m.cell}` : ''}`;
        return {
          id: m.id,
          taken: !!other,
          label: other ? `${name} — read by ${other.ip ?? 'another scanner'}` : name,
        };
      });
  });

  protected readonly form = new FormGroup({
    ip: new FormControl<string | null>(null, [
      Validators.required,
      Validators.pattern(IPV4_PATTERN),
    ]),
    model: new FormControl<string | null>(null),
    type: new FormControl<string | null>(null),
    description: new FormControl<string | null>(null),
    machine_id: new FormControl<string | null>(null),
    sn_scanner: new FormControl<string | null>(null),
    sn_queue: new FormControl<string | null>(null),
    sn_procces: new FormControl<string | null>(null),
    status: new FormControl('Active', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      const s = this.scanner();
      const isOpen = this.open();
      untracked(() => {
        this.error.set(null);
        if (!isOpen) return;
        this.form.reset({ status: 'Active' });
        if (s) this.form.patchValue(s);
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
    const blank = (x: string | null) => (x?.trim() ? x.trim() : null);
    const body = {
      ...v,
      model: blank(v.model),
      type: blank(v.type),
      description: blank(v.description),
      sn_scanner: blank(v.sn_scanner),
      sn_queue: blank(v.sn_queue),
      sn_procces: blank(v.sn_procces),
    };
    const existing = this.scanner();
    const req = existing ? this.api.update(existing.id, body) : this.api.create(body);
    req.subscribe({
      next: (s) => {
        this.busy.set(false);
        this.saved.emit(s);
        this.open.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
