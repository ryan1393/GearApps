import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiErrorMessage, GearsetsApi } from '@meshforge/client/core';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { DialogComponent, SegmentedComponent } from '@meshforge/client/ui';
import { Gearset, Part, Summary } from '@meshforge/shared/domain';
import { STATUS_OPTIONS, toStatusOption } from './lapping-shared';

@Component({
  selector: 'gear-gearset-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="gearset() ? 'Edit gearset ' + gearset()?.number : 'Add gearset'"
      [description]="
        gearset()
          ? 'Number, parts and summary are fixed once a gearset has been assembled.'
          : 'Pair a pinion with a ring from the same summary. The ratio is ring teeth ÷ pinion teeth.'
      "
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="gearsetForm" class="gear-form-grid">
        <label class="gear-field">
          Gearset number
          <input class="gear-input" formControlName="number" placeholder="060GS104" />
        </label>
        <label class="gear-field">
          Revision
          <input class="gear-input" formControlName="rev" placeholder="A" />
        </label>
        <label class="gear-field dana-field-full">
          Summary
          <select class="gear-select" formControlName="summary_id">
            <option [ngValue]="null">Use the ring’s summary</option>
            @for (s of summaries(); track s.id) {
              <option [ngValue]="s.id">
                {{ s.number }}{{ s.model ? ' · model ' + s.model : '' }}
              </option>
            }
          </select>
          <small class="gear-field-help"
            >Pinion and ring lists narrow to parts with the same summary number.</small
          >
        </label>
        <label class="gear-field">
          Pinion
          <select class="gear-select" formControlName="pinion_id">
            <option [ngValue]="null" disabled>Select pinion</option>
            @for (p of pinions(); track p.id) {
              <option [ngValue]="p.id">{{ p.label }}</option>
            }
          </select>
        </label>
        <label class="gear-field">
          Ring
          <select class="gear-select" formControlName="ring_id">
            <option [ngValue]="null" disabled>Select ring</option>
            @for (r of rings(); track r.id) {
              <option [ngValue]="r.id">{{ r.label }}</option>
            }
          </select>
        </label>
        <div class="gear-field">
          <span>Ratio</span>
          <output class="gear-input" aria-live="polite">{{ ratioText() }}</output>
          <small class="gear-field-help">Calculated from the tooth counts.</small>
        </div>
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
          form="gearsetForm"
          class="gear-btn gear-btn-primary"
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Saving…' : gearset() ? 'Save changes' : 'Add gearset' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
})
export class GearsetFormDialogComponent {
  private readonly api = inject(GearsetsApi);
  private readonly session = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly gearset = input<Gearset | null>(null);
  readonly parts = input<Part[]>([]);
  readonly summaries = input<Summary[]>([]);
  readonly saved = output<Gearset>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statuses = STATUS_OPTIONS;
  /** Form values as signals, so the part lists and ratio follow the selections. */
  private readonly values = signal<{
    summary_id?: string | null;
    pinion_id?: string | null;
    ring_id?: string | null;
  }>({});
  /** Summary family (number, case-insensitive) the pinion and ring must share. */
  private readonly family = computed(() => {
    const v = this.values();
    const byId = (id?: string | null) => this.parts().find((p) => p.id === id);
    const summaryNumber =
      this.summaries().find((s) => s.id === v.summary_id)?.number ??
      byId(v.ring_id)?.summary?.number ??
      byId(v.pinion_id)?.summary?.number;
    return summaryNumber?.trim().toLowerCase() ?? null;
  });
  protected readonly pinions = computed(() => this.options('Pinion'));
  protected readonly rings = computed(() => this.options('Ring'));
  protected readonly ratioText = computed(() => {
    const v = this.values();
    const pin = this.parts().find((p) => p.id === v.pinion_id);
    const ring = this.parts().find((p) => p.id === v.ring_id);
    if (!pin?.teeth || !ring?.teeth) return this.gearset()?.ratio?.toFixed(4) ?? '—';
    return `${(ring.teeth / pin.teeth).toFixed(4)}  (${ring.teeth}:${pin.teeth})`;
  });

  protected readonly form = new FormGroup({
    number: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    rev: new FormControl<string | null>(null),
    pinion_id: new FormControl<string | null>(null, Validators.required),
    ring_id: new FormControl<string | null>(null, Validators.required),
    summary_id: new FormControl<string | null>(null),
    status: new FormControl('Active', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      const g = this.gearset();
      const isOpen = this.open();
      untracked(() => {
        this.error.set(null);
        if (!isOpen) return;
        this.form.reset({ status: 'Active' });
        this.form.enable();
        if (g) {
          this.form.patchValue({
            number: g.number,
            rev: g.rev,
            pinion_id: g.pinion_id,
            ring_id: g.ring_id,
            summary_id: g.summary_id,
            status: toStatusOption(g.status),
          });
          ['number', 'pinion_id', 'ring_id', 'summary_id'].forEach((k) =>
            this.form.get(k)?.disable(),
          );
        }
        this.values.set(this.form.getRawValue());
      });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.values.set(this.form.getRawValue()));

    // Choosing a different summary drops parts that no longer belong to it.
    this.form.controls.summary_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const { pinion_id, ring_id } = this.form.controls;
        if (pinion_id.enabled && !this.pinions().some((p) => p.id === pinion_id.value))
          pinion_id.setValue(null);
        if (ring_id.enabled && !this.rings().some((r) => r.id === ring_id.value))
          ring_id.setValue(null);
      });
  }

  private options(type: 'Pinion' | 'Ring') {
    const family = this.family();
    return this.parts()
      .filter((p) => p.type === type)
      .filter((p) => !family || p.summary?.number?.trim().toLowerCase() === family)
      .map((p) => ({ id: p.id, label: `${p.number}${p.teeth ? ` · ${p.teeth}T` : ''}` }));
  }

  protected save() {
    if (this.form.invalid || this.busy()) return;
    const userId = this.session.currentUser?.sub ?? null;
    if (!userId) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const existing = this.gearset();
    const req = existing
      ? this.api.update(existing.id, { rev: v.rev, status: v.status, user_id: userId })
      : // The API derives the ratio from the tooth counts.
        this.api.create({ ...v, ratio: null, user_id: userId });
    req.subscribe({
      next: (g) => {
        this.busy.set(false);
        this.saved.emit(g);
        this.open.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
