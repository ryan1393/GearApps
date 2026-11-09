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
import { apiErrorMessage, AuthService, GearsetsApi } from '@gearapps/client/core';
import { DialogComponent, SegmentedComponent } from '@gearapps/client/ui';
import { Gearset, Part, Summary } from '@gearapps/shared/domain';
import { STATUS_OPTIONS } from './shared';

@Component({
  selector: 'gear-gearset-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="gearset() ? 'Edit gearset ' + gearset()?.number : 'Add gearset'"
      description="A gearset pairs a pinion with a ring. The ratio is pre-filled as ring teeth ÷ pinion teeth."
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="gearsetForm" class="dana-form-grid">
        <label class="dana-field"
          ><span class="dana-field-head"
            ><span>Gearset number</span
            ><span class="dana-field-tag is-required">Required</span></span
          ><input class="dana-input" formControlName="number"
        /></label>
        <label class="dana-field"
          ><span class="dana-field-head"
            ><span>Revision</span><span class="dana-field-tag">Optional</span></span
          ><input class="dana-input" formControlName="rev" placeholder="A"
        /></label>
        <label class="dana-field">
          <span class="dana-field-head"
            ><span>Pinion</span><span class="dana-field-tag is-required">Required</span></span
          >
          <select class="dana-select" formControlName="pinion_id">
            <option [ngValue]="null" disabled>Select pinion</option>
            @for (p of pinions(); track p.id) {
              <option [ngValue]="p.id">{{ p.label }}</option>
            }
          </select>
        </label>
        <label class="dana-field">
          <span class="dana-field-head"
            ><span>Ring</span><span class="dana-field-tag is-required">Required</span></span
          >
          <select class="dana-select" formControlName="ring_id">
            <option [ngValue]="null" disabled>Select ring</option>
            @for (r of rings(); track r.id) {
              <option [ngValue]="r.id">{{ r.label }}</option>
            }
          </select>
        </label>
        <label class="dana-field">
          <span class="dana-field-head"
            ><span>Ratio</span><span class="dana-field-tag" data-tone="info">Auto</span></span
          >
          <input class="dana-input" type="number" step="0.0001" formControlName="ratio" />
          <small class="dana-field-hint"
            >Override if the drawing specifies a different ratio.</small
          >
        </label>
        <label class="dana-field">
          <span class="dana-field-head"
            ><span>Summary</span><span class="dana-field-tag">Optional</span></span
          >
          <select class="dana-select" formControlName="summary_id">
            <option [ngValue]="null">No summary</option>
            @for (s of summaries(); track s.id) {
              <option [ngValue]="s.id">{{ s.number }} · {{ s.model }}</option>
            }
          </select>
        </label>
        <div class="dana-field">
          <span>Status</span
          ><gear-segmented formControlName="status" [options]="statuses" ariaLabel="Status" />
        </div>
        @if (error()) {
          <p class="dana-alert dana-alert-danger dana-field-full" role="alert">{{ error() }}</p>
        }
      </form>
      <ng-container dialogActions>
        <button type="button" class="dana-btn dana-btn-ghost" (click)="open.set(false)">
          Cancel
        </button>
        <button
          type="submit"
          form="gearsetForm"
          class="dana-btn dana-btn-primary"
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
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly gearset = input<Gearset | null>(null);
  readonly parts = input<Part[]>([]);
  readonly summaries = input<Summary[]>([]);
  readonly saved = output<Gearset>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statuses = STATUS_OPTIONS;
  protected readonly pinions = computed(() => this.options('Pinion'));
  protected readonly rings = computed(() => this.options('Ring'));

  protected readonly form = new FormGroup({
    number: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    rev: new FormControl<string | null>(null),
    pinion_id: new FormControl<string | null>(null, Validators.required),
    ring_id: new FormControl<string | null>(null, Validators.required),
    ratio: new FormControl<number | null>(null),
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
            ratio: g.ratio,
            summary_id: g.summary_id,
            status: g.status,
          });
          ['number', 'pinion_id', 'ring_id', 'ratio', 'summary_id'].forEach((k) =>
            this.form.get(k)?.disable(),
          );
        }
      });
    });

    // Legacy behaviour: ratio = ring teeth / pinion teeth until the user edits it.
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ pinion_id, ring_id }) => {
        const ratio = this.form.controls.ratio;
        if (!ratio.enabled || ratio.dirty) return;
        const pin = this.parts().find((p) => p.id === pinion_id);
        const ring = this.parts().find((p) => p.id === ring_id);
        if (pin?.teeth && ring?.teeth)
          ratio.setValue(Number((ring.teeth / pin.teeth).toFixed(4)), { emitEvent: false });
      });
  }

  private options(type: string) {
    return this.parts()
      .filter((p) => p.type === type)
      .map((p) => ({ id: p.id, label: `${p.number}${p.teeth ? ` · ${p.teeth}T` : ''}` }));
  }

  protected save() {
    if (this.form.invalid || this.busy()) return;
    const userId = this.auth.userId();
    if (!userId) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const existing = this.gearset();
    const req = existing
      ? this.api.update(existing.id, { rev: v.rev, status: v.status, user_id: userId })
      : this.api.create({
          ...v,
          ratio: v.ratio === null ? null : Number(v.ratio),
          user_id: userId,
        });
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
