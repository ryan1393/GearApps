import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CollectorMachine, ScannerApi, ToastService } from '@meshforge/client/core';

interface Cmd {
  label: string;
  op: string;
  /** MeshForge button tone; secondary when omitted. */
  cls?: string;
}

/** Op codes carried over from the legacy scanner panel. `output` marks an output's On/Off pair. */
const GROUPS: { label: string; output?: number; cmds: Cmd[] }[] = [
  {
    label: 'Output 1',
    output: 1,
    cmds: [
      { label: 'On', op: 'OUTON,1' },
      { label: 'Off', op: 'OUTOFF,1' },
    ],
  },
  {
    label: 'Output 2',
    output: 2,
    cmds: [
      { label: 'On', op: 'OUTON,2' },
      { label: 'Off', op: 'OUTOFF,2' },
    ],
  },
  {
    label: 'Tuning',
    cmds: [
      { label: 'Tune', op: 'TUNE01' },
      { label: 'Focus', op: 'FTUNE' },
    ],
  },
  {
    label: 'Test',
    cmds: [
      { label: 'Start', op: 'TEST0' },
      { label: 'Quit', op: 'QUIT', cls: 'gear-btn-danger' },
    ],
  },
  {
    label: 'Trigger',
    cmds: [
      { label: 'On', op: 'LON01', cls: 'gear-btn-success' },
      { label: 'Off', op: 'LOFF' },
    ],
  },
];

@Component({
  selector: 'gear-scanner-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="gear-ctl-io" role="group" aria-label="Scanner inputs">
      <span class="dana-detail-label">Inputs</span>
      @for (i of inputs; track i.terminal) {
        <span class="dana-status-badge" [attr.data-tone]="inputState(i.terminal) ? 'success' : 'neutral'"
          >{{ i.label }}: {{ onOff(inputState(i.terminal)) }}</span
        >
      }
    </div>
    <div class="gear-ctl">
      @for (g of groups; track g.label) {
        <div class="gear-ctl-group" role="group" [attr.aria-label]="g.label">
          <span class="dana-detail-label"
            >{{ g.label }}
            @if (g.output) {
              <span
                class="dana-status-badge"
                [attr.data-tone]="outputState(g.output) ? 'success' : 'neutral'"
                title="As last set from MeshForge; the scanner can also switch its outputs itself"
                >{{ onOff(outputState(g.output)) }}</span
              >
            }
          </span>
          <div class="gear-actions">
            @for (c of g.cmds; track c.op) {
              <button
                type="button"
                class="gear-btn gear-btn-sm {{ buttonClass(g.output, c) }}"
                [disabled]="pending() !== null"
                [attr.aria-pressed]="g.output ? isCurrent(g.output, c) : null"
                [attr.aria-label]="g.label + ' ' + c.label"
                [attr.aria-busy]="pending() === c.op"
                (click)="send(c.op)"
              >
                {{ pending() === c.op ? 'Sending…' : c.label }}
              </button>
            }
          </div>
        </div>
      }
    </div>
    <small class="gear-ctl-note gear-muted"
      >Outputs show what was last set here{{ outputsSetAt() ? ' (' + (outputsSetAt() | date: 'shortTime') + ')' : '' }};
      the scanner cannot report them and may switch them itself. Inputs are read from the scanner.</small
    >
  `,
  styles: `
    .gear-ctl-io {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--dana-space-2);
      margin-bottom: var(--dana-form-gap);
    }
    .gear-ctl-note {
      display: block;
      margin-top: var(--dana-field-gap);
    }
    .gear-ctl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
      gap: var(--dana-form-gap);
    }
    .gear-ctl-group {
      display: grid;
      gap: var(--dana-field-gap);
    }
  `,
})
export class ScannerControlsComponent {
  private readonly api = inject(ScannerApi);
  private readonly toast = inject(ToastService);
  private readonly destroy = inject(DestroyRef);
  readonly scannerId = input.required<string>();
  /** Lapper Read's row for the machine: input states and the outputs as last set here. */
  readonly io = input<CollectorMachine | null>(null);
  protected readonly groups = GROUPS;
  protected readonly inputs = [
    { terminal: 1, label: 'Input 1 (photoeye)' },
    { terminal: 2, label: 'Input 2' },
  ];
  protected readonly outputsSetAt = computed(() => this.io()?.scanner_outputs_set_at ?? null);

  /** true on, false off, null unknown (no collector, scanner offline, or not read yet). */
  protected inputState(terminal: number): boolean | null {
    return this.io()?.scanner_inputs?.[String(terminal)] ?? null;
  }

  /** As last switched from MeshForge; null when it has not been set since the collector started. */
  protected outputState(terminal: number): boolean | null {
    return this.io()?.scanner_outputs?.[String(terminal)] ?? null;
  }

  protected onOff(state: boolean | null): string {
    return state === null ? 'unknown' : state ? 'ON' : 'OFF';
  }

  protected isCurrent(terminal: number, c: Cmd): boolean {
    const state = this.outputState(terminal);
    return state !== null && state === c.op.startsWith('OUTON');
  }

  /** An output's button for its current state is highlighted; other buttons keep their tone. */
  protected buttonClass(terminal: number | undefined, c: Cmd): string {
    if (terminal) return this.isCurrent(terminal, c) ? 'gear-btn-primary' : 'gear-btn-secondary';
    return c.cls ?? 'gear-btn-secondary';
  }
  protected readonly pending = signal<string | null>(null);

  protected send(op: string) {
    if (this.pending() !== null) return;
    this.pending.set(op);
    this.api.command(this.scannerId(), op).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (r) => {
        this.pending.set(null);
        this.toast.info(`Sent ${op}`, r.data ? String(r.data).slice(0, 80) : '');
      },
      error: (err) => {
        this.pending.set(null);
        this.toast.error(err, `Command ${op} failed`);
      },
    });
  }
}
