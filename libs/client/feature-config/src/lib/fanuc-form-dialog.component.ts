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
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { apiErrorMessage, FanucVariablesApi } from '@meshforge/client/core';
import { DialogComponent, SegmentedComponent } from '@meshforge/client/ui';
import { Machine, MachineFanucVariable } from '@meshforge/shared/domain';
import { FANUC_SIGNALS, ON_OFF_OPTIONS } from './options';

@Component({
  selector: 'gear-fanuc-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-dialog
      [open]="open()"
      [dismissible]="!busy()"
      (openChange)="open.set($event)"
      [title]="
        (snapshot() ? 'Fanuc I/O · ' : 'Set up Fanuc I/O · ') +
        (machine()?.number ?? machine()?.ip ?? '')
      "
      description="The PLC signals the live cell view shows. The machine collector normally writes these; set them here to commission a machine or test the screens."
      width="520px"
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="fanucForm" class="lapper-fanuc-form">
        @for (s of signals; track s.key) {
          <div class="gear-field">
            <span
              >{{ s.label }} <span class="gear-muted mono">{{ s.address }}</span></span
            >
            <gear-segmented [formControlName]="s.key" [options]="onOff" [ariaLabel]="s.label" />
          </div>
        }
        @if (error()) {
          <p class="gear-alert gear-alert-danger" role="alert">{{ error() }}</p>
        }
      </form>
      <ng-container dialogActions>
        <button type="button" class="gear-btn gear-btn-secondary" (click)="open.set(false)" [disabled]="busy()">
          Cancel
        </button>
        <button
          type="submit"
          form="fanucForm"
          class="gear-btn gear-btn-primary"
          [disabled]="busy()"
        >
          {{ busy() ? 'Saving…' : snapshot() ? 'Save signals' : 'Create I/O snapshot' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
  styles: `
    .lapper-fanuc-form {
      display: grid;
      gap: var(--dana-form-gap);
    }
  `,
})
export class FanucFormDialogComponent {
  private readonly api = inject(FanucVariablesApi);

  readonly open = model(false);
  readonly machine = input<Machine | null>(null);
  readonly snapshot = input<MachineFanucVariable | null>(null);
  readonly saved = output<MachineFanucVariable>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly signals = FANUC_SIGNALS;
  protected readonly onOff = ON_OFF_OPTIONS;

  protected readonly form = new FormGroup({
    x06_7_frt_dr_closed: new FormControl(false, { nonNullable: true }),
    x01_2_start_cycle: new FormControl(false, { nonNullable: true }),
    y03_2_stack_inCycle: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const s = this.snapshot();
      const isOpen = this.open();
      untracked(() => {
        this.error.set(null);
        if (!isOpen) return;
        this.form.reset({
          x06_7_frt_dr_closed: !!s?.x06_7_frt_dr_closed,
          x01_2_start_cycle: !!s?.x01_2_start_cycle,
          y03_2_stack_inCycle: !!s?.y03_2_stack_inCycle,
        });
      });
    });
  }

  protected save() {
    const machine = this.machine();
    if (this.busy() || !machine) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const existing = this.snapshot();
    const req = existing
      ? this.api.update(existing.id, v)
      : this.api.create({ ...v, machine_id: machine.id });
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
