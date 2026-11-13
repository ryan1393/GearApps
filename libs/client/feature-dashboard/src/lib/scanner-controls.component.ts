import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { DanaTooltipDirective } from '@dana/ui';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CollectorMachine, ScannerApi, ToastService } from '@meshforge/client/core';

interface Cmd {
  label: string;
  op: string;
  /** Dana button icon (data-icon). */
  icon: string;
  /** What the button does, shown on hover and focus. */
  tip: string;
  /** MeshForge button tone; secondary when omitted. */
  cls?: string;
}

/** Op codes carried over from the legacy scanner panel. `output` marks an output's On/Off pair. */
const GROUPS: { label: string; output?: number; cmds: Cmd[] }[] = [
  {
    label: 'Output 1',
    output: 1,
    cmds: [
      { label: 'On', op: 'OUTON,1', icon: 'power', tip: 'Turn output 1 on (OUTON,1)' },
      { label: 'Off', op: 'OUTOFF,1', icon: 'power-off', tip: 'Turn output 1 off (OUTOFF,1)' },
    ],
  },
  {
    label: 'Output 2',
    output: 2,
    cmds: [
      { label: 'On', op: 'OUTON,2', icon: 'power', tip: 'Turn output 2 on (OUTON,2)' },
      { label: 'Off', op: 'OUTOFF,2', icon: 'power-off', tip: 'Turn output 2 off (OUTOFF,2)' },
    ],
  },
  {
    label: 'Tuning',
    cmds: [
      { label: 'Tune', op: 'TUNE01', icon: 'tune', tip: 'Tune: the scanner sets its reading conditions for the code in view (TUNE01)' },
      { label: 'Focus', op: 'FTUNE', icon: 'focus', tip: 'Focus: the scanner adjusts its focus to the part in view (FTUNE)' },
    ],
  },
  {
    label: 'Test',
    cmds: [
      { label: 'Start', op: 'TEST0', icon: 'play', tip: 'Start the scanner test mode (TEST0)' },
      { label: 'Quit', op: 'QUIT', icon: 'stop', tip: 'Quit the scanner test mode (QUIT)', cls: 'gear-btn-danger' },
    ],
  },
  {
    label: 'Trigger',
    cmds: [
      { label: 'On', op: 'LON01', icon: 'trigger-on', tip: 'Trigger a read now (LON01)', cls: 'gear-btn-success' },
      { label: 'Off', op: 'LOFF', icon: 'trigger-off', tip: 'Stop reading (LOFF)' },
    ],
  },
];

@Component({
  selector: 'gear-scanner-controls',
  host: {
    '[class.gear-ctl-compact]': 'compact()',
    '[class.gear-ctl-actions]': "part() === 'actions'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, NgTemplateOutlet, DanaTooltipDirective],
  template: `
    <ng-template #buttons let-g>
      <div class="gear-actions">
        @for (c of g.cmds; track c.op) {
          <button
            type="button"
            class="gear-btn gear-btn-sm {{ buttonClass(g.output, c) }}"
            [attr.data-icon]="c.icon"
            [danaTooltip]="pending() === c.op ? 'Sending ' + c.op + '…' : c.tip"
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
    </ng-template>

    @if (part() === 'outputs') {
      <!-- One line per output: its state as last set here, then On / Off. -->
      <div class="gear-ctl-rows">
        @for (g of shownGroups(); track g.label) {
          <div class="gear-ctl-row" role="group" [attr.aria-label]="g.label" [attr.title]="outputTitle()">
            <span class="dana-detail-label">{{ g.label }}*</span>
            <span class="dana-status-badge" [attr.data-tone]="outputState(g.output!) ? 'success' : 'neutral'">{{
              onOff(outputState(g.output!))
            }}</span>
            <ng-container *ngTemplateOutlet="buttons; context: { $implicit: g }" />
          </div>
        }
      </div>
    } @else {
      <div class="gear-ctl">
        @for (g of shownGroups(); track g.label) {
          <div class="gear-ctl-group" role="group" [attr.aria-label]="g.label" [attr.title]="g.output ? outputTitle() : null">
            <span class="dana-detail-label">{{ g.label }}</span>
            <ng-container *ngTemplateOutlet="buttons; context: { $implicit: g }" />
          </div>
        }
      </div>
      @if (part() === 'all') {
        <small class="gear-ctl-note gear-muted"
          >Highlighted: the output state last set here{{ outputsSetAt() ? ' (' + (outputsSetAt() | date: 'shortTime') + ')' : '' }}.
          The scanner cannot report its outputs and may switch them itself.</small
        >
      }
    }
  `,
  styles: `
    .gear-ctl-note {
      display: block;
      margin-top: var(--dana-field-gap);
    }
    .gear-ctl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr));
      gap: var(--dana-space-2) var(--dana-space-3);
    }
    .gear-ctl-group {
      display: grid;
      gap: var(--dana-field-gap);
    }
    /* Inside a card fitted to the screen: three groups a row, shorter buttons, no footnote. */
    :host(.gear-ctl-compact) .gear-ctl {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--dana-space-1) var(--dana-space-3);
    }
    :host(.gear-ctl-compact) .gear-ctl-group {
      gap: 2px;
    }
    :host(.gear-ctl-compact) .gear-btn {
      min-height: 2rem;
      padding-block: 0;
    }
    :host(.gear-ctl-compact) .gear-ctl-note {
      display: none;
    }
    /* Outputs: label, state, then On / Off, one output a line. */
    .gear-ctl-rows {
      display: grid;
      gap: 2px;
    }
    .gear-ctl-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: var(--dana-space-2);
    }
    .gear-ctl-row .gear-actions {
      flex-wrap: nowrap;
    }
    /* Actions: every group on one wrapping line, label beside its buttons. */
    :host(.gear-ctl-actions) .gear-ctl {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--dana-space-1) var(--dana-space-4);
    }
    :host(.gear-ctl-actions) .gear-ctl-group {
      display: flex;
      align-items: center;
      gap: var(--dana-space-1);
    }
    :host(.gear-ctl-compact) .gear-ctl-row .gear-btn,
    :host(.gear-ctl-compact.gear-ctl-actions) .gear-btn {
      min-height: 1.75rem;
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
  /** Shorter buttons and no footnote, to fit a card sized to the screen. */
  readonly compact = input(false);
  /** 'outputs': the two outputs with their state; 'actions': tuning, test and trigger; 'all': everything. */
  readonly part = input<'all' | 'outputs' | 'actions'>('all');
  protected readonly shownGroups = computed(() => {
    const part = this.part();
    return part === 'all' ? GROUPS : GROUPS.filter((g) => (part === 'outputs') === !!g.output);
  });
  protected readonly outputsSetAt = computed(() => this.io()?.scanner_outputs_set_at ?? null);
  protected readonly outputTitle = computed(() => {
    const at = this.outputsSetAt();
    const when = at ? ` (${new Date(at).toLocaleTimeString()})` : '';
    return `* The state last set here${when}. The scanner cannot report its outputs and may switch them itself.`;
  });

  protected onOff(state: boolean | null): string {
    return state === null ? '—' : state ? 'ON' : 'OFF';
  }

  /** As last switched from MeshForge; null when it has not been set since the collector started. */
  protected outputState(terminal: number): boolean | null {
    return this.io()?.scanner_outputs?.[String(terminal)] ?? null;
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
