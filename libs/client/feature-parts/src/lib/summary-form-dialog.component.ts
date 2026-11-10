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
import { apiErrorMessage, AuthService, SummariesApi } from '@gearapps/client/core';
import { DialogComponent, SegmentedComponent } from '@gearapps/client/ui';
import { Summary } from '@gearapps/shared/domain';
import { STATUS_OPTIONS, toStatusOption } from './shared';

@Component({
  selector: 'gear-summary-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="summary() ? 'Edit summary ' + summary()?.number : 'Add part summary'"
      width="520px"
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="summaryForm" class="dana-form-grid">
        <label class="dana-field"
          ><span class="dana-field-head"
            ><span>Summary number</span
            ><span class="dana-field-tag is-required">Required</span></span
          ><input class="dana-input" formControlName="number" placeholder="220"
        /></label>
        <label class="dana-field"
          ><span class="dana-field-head"
            ><span>Model</span><span class="dana-field-tag is-required">Required</span></span
          ><input class="dana-input" formControlName="model" placeholder="S-220"
        /></label>
        <label class="dana-field"
          ><span class="dana-field-head"
            ><span>HOS</span><span class="dana-field-tag is-required">Required</span></span
          ><input class="dana-input" formControlName="hos"
        /></label>
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
          form="summaryForm"
          class="dana-btn dana-btn-primary"
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
  private readonly auth = inject(AuthService);
  readonly open = model(false);
  readonly summary = input<Summary | null>(null);
  readonly saved = output<Summary>();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statuses = STATUS_OPTIONS;
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
    const userId = this.auth.userId();
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
