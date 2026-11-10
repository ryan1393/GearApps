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
import { apiErrorMessage, PartsApi } from '@gearapps/client/core';
import { AuthSessionService } from '@gearapps/manufacturing/frontend/data-access-user';
import { DialogComponent, SegmentedComponent } from '@gearapps/client/ui';
import { Part, Summary } from '@gearapps/shared/domain';
import { PART_TYPE_OPTIONS, STATUS_OPTIONS } from './shared';

@Component({
  selector: 'gear-part-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="part() ? 'Edit part ' + part()?.number : 'Add part'"
      [description]="
        part()
          ? 'Part number and type are owned by GearApps master data.'
          : 'Pinions and rings are later paired into gearsets.'
      "
      width="560px"
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="partForm" class="gear-form-grid">
        <div class="gear-field dana-field-full">
          <span>Type</span>
          <gear-segmented formControlName="type" [options]="types" ariaLabel="Part type" />
        </div>
        <label class="gear-field">
          Part number
          <input class="gear-input" formControlName="number" placeholder="060GP104" />
        </label>
        <label class="gear-field">
          Teeth
          <input class="gear-input" type="number" min="1" max="999" formControlName="teeth" />
        </label>
        <label class="gear-field dana-field-full">
          Summary
          <select class="gear-select" formControlName="summary_id">
            <option [ngValue]="null" disabled>Choose a summary</option>
            @for (s of summaries(); track s.id) {
              <option [ngValue]="s.id">
                {{ s.number }}{{ s.model ? ' · model ' + s.model : '' }}
              </option>
            }
          </select>
          <small class="gear-field-help"
            >Rings and pinions that share a summary number can be paired into a gearset.</small
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
        <button type="button" class="gear-btn gear-btn-secondary" (click)="open.set(false)">
          Cancel
        </button>
        <button
          type="submit"
          form="partForm"
          class="gear-btn gear-btn-primary"
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Saving…' : part() ? 'Save changes' : 'Add part' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
})
export class PartFormDialogComponent {
  private readonly api = inject(PartsApi);
  private readonly session = inject(AuthSessionService);
  readonly open = model(false);
  readonly part = input<Part | null>(null);
  readonly summaries = input<Summary[]>([]);
  readonly saved = output<Part>();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly types = PART_TYPE_OPTIONS;
  protected readonly statuses = STATUS_OPTIONS;
  protected readonly form = new FormGroup({
    type: new FormControl('Pinion', { nonNullable: true, validators: [Validators.required] }),
    number: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    teeth: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    summary_id: new FormControl<string | null>(null, Validators.required),
    status: new FormControl('Active', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      const p = this.part();
      const isOpen = this.open();
      untracked(() => {
        this.error.set(null);
        if (!isOpen) return;
        this.form.reset({ type: 'Pinion', status: 'Active' });
        this.form.enable();
        if (p) {
          this.form.patchValue({
            type: p.type,
            number: p.number,
            teeth: p.teeth,
            summary_id: p.summary_id,
            status: p.status,
          });
          this.form.controls.number.disable();
          this.form.controls.type.disable();
        }
      });
    });
  }

  protected save() {
    if (this.form.invalid || this.busy()) return;
    const userId = this.session.currentUser?.sub ?? null;
    if (!userId) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const existing = this.part();
    const req = existing
      ? this.api.update(existing.id, {
          status: v.status,
          summary_id: v.summary_id,
          teeth: v.teeth,
          user_id: userId,
        })
      : this.api.create({
          ...v,
          teeth: v.teeth === null ? null : Number(v.teeth),
          user_id: userId,
          ring_id: null,
          pinion_id: null,
        });
    req.subscribe({
      next: (p) => {
        this.busy.set(false);
        this.saved.emit(p);
        this.open.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
