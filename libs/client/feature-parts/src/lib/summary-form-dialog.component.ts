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
import { apiErrorMessage, SummariesApi } from '@gearapps/client/core';
import { AuthSessionService } from '@gearapps/manufacturing/frontend/data-access-user';
import { DialogComponent, SegmentedComponent } from '@gearapps/client/ui';
import { Summary } from '@gearapps/shared/domain';
import { HAND_OPTIONS, STATUS_OPTIONS, toStatusOption } from './shared';

@Component({
  selector: 'gear-summary-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="summary() ? 'Edit summary ' + summary()?.number : 'Add part summary'"
      [description]="
        summary()
          ? 'Summary number, model and hand of spiral are owned by GearApps master data.'
          : 'A summary groups the ring, pinion and gearset that are lapped together.'
      "
      width="560px"
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="summaryForm" class="gear-form-grid">
        <label class="gear-field">
          Summary number
          <input class="gear-input" formControlName="number" placeholder="S060586" />
        </label>
        <label class="gear-field">
          Model
          <input class="gear-input" formControlName="model" placeholder="248" inputmode="numeric" />
          @if (!summary()) {
            <small class="gear-field-help"
              >Use a model number that already exists in GearApps.</small
            >
          }
        </label>
        <div class="gear-field">
          <span>Hand of spiral</span>
          <gear-segmented formControlName="hos" [options]="hands" ariaLabel="Hand of spiral" />
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
          form="summaryForm"
          class="gear-btn gear-btn-primary"
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Saving…' : summary() ? 'Save changes' : 'Add summary' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
})
export class SummaryFormDialogComponent {
  private readonly api = inject(SummariesApi);
  private readonly session = inject(AuthSessionService);
  readonly open = model(false);
  readonly summary = input<Summary | null>(null);
  readonly saved = output<Summary>();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statuses = STATUS_OPTIONS;
  protected readonly hands = HAND_OPTIONS;
  protected readonly form = new FormGroup({
    number: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    model: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    hos: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    status: new FormControl('Active', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      const s = this.summary();
      const isOpen = this.open();
      untracked(() => {
        this.error.set(null);
        if (!isOpen) return;
        this.form.reset({ status: 'Active' });
        this.form.enable();
        if (s) {
          this.form.patchValue({ ...s, status: toStatusOption(s.status) });
          ['number', 'model', 'hos'].forEach((k) => this.form.get(k)?.disable());
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
    const existing = this.summary();
    const req = existing
      ? this.api.update(existing.id, { status: v.status, user_id: userId })
      : this.api.create({ ...v, user_id: userId });
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
