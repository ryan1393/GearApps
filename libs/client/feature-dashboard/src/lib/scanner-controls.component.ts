import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ScannerApi, ToastService } from '@meshforge/client/core';

interface Cmd {
  label: string;
  op: string;
  /** MeshForge button tone; secondary when omitted. */
  cls?: string;
}

/** Op codes carried over from the legacy scanner panel. */
const GROUPS: { label: string; cmds: Cmd[] }[] = [
  {
    label: 'Output 1',
    cmds: [
      { label: 'On', op: 'OUTON,1', cls: 'gear-btn-success' },
      { label: 'Off', op: 'OUTOFF,1' },
    ],
  },
  {
    label: 'Output 2',
    cmds: [
      { label: 'On', op: 'OUTON,2', cls: 'gear-btn-success' },
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
  template: `
    <div class="gear-ctl">
      @for (g of groups; track g.label) {
        <div class="gear-ctl-group">
          <span class="dana-detail-label">{{ g.label }}</span>
          <div class="gear-actions">
            @for (c of g.cmds; track c.op) {
              <button
                type="button"
                class="gear-btn gear-btn-sm {{ c.cls ?? 'gear-btn-secondary' }}"
                [disabled]="pending() !== null"
                (click)="send(c.op)"
              >
                {{ pending() === c.op ? '…' : c.label }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .gear-ctl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
    }
    .gear-ctl-group {
      display: grid;
      gap: 6px;
    }
  `,
})
export class ScannerControlsComponent {
  private readonly api = inject(ScannerApi);
  private readonly toast = inject(ToastService);
  readonly scannerId = input.required<string>();
  protected readonly groups = GROUPS;
  protected readonly pending = signal<string | null>(null);

  protected send(op: string) {
    this.pending.set(op);
    this.api.command(this.scannerId(), op).subscribe({
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
