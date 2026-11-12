import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import {
  formatAge,
  formatRunningTime,
  liveCycleState,
  MachineFanucVariable,
} from '@meshforge/shared/domain';

/**
 * How long a lapper's current cycle has been running, counting up every second between polls.
 * Shows "Not in cycle" between cycles, and "No update for …" when the collector has stopped
 * reporting, so a stopped collector never leaves a timer running.
 */
@Component({
  selector: 'gear-live-cycle-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state().kind) {
      @case ('running') {
        <span class="dana-status-badge gear-live-timer" data-tone="success" data-testid="live-cycle-timer" role="timer"
          >In cycle <strong class="mono">{{ running() }}</strong></span
        >
      }
      @case ('running-unknown') {
        <span class="dana-status-badge" data-tone="success" data-testid="live-cycle-timer"
          title="The collector started during this cycle, so its start is not known">In cycle · time unknown</span
        >
      }
      @case ('idle') {
        <span class="gear-muted" data-testid="live-cycle-timer">Not in cycle</span>
      }
      @case ('stale') {
        <span class="dana-status-badge" data-tone="warning" data-testid="live-cycle-timer"
          title="Lapper Read has not reported this machine; check the collector on the Fanuc Variables page"
          >No update for {{ age() }}</span
        >
      }
      @default {
        <span class="gear-muted" data-testid="live-cycle-timer">—</span>
      }
    }
  `,
  styles: `
    .gear-live-timer strong { font-variant-numeric: tabular-nums; }
  `,
})
export class LiveCycleTimerComponent {
  /** The machine's latest I/O snapshot. */
  readonly snapshot = input<MachineFanucVariable | null | undefined>(null);
  /** When the snapshot was received (Date.now()). */
  readonly receivedAt = input<number>(Date.now());

  private readonly now = signal(Date.now());
  protected readonly state = computed(() => liveCycleState(this.snapshot(), this.receivedAt(), this.now()));
  protected readonly running = computed(() => {
    const state = this.state();
    return state.kind === 'running' ? formatRunningTime(state.seconds) : '';
  });
  protected readonly age = computed(() => {
    const state = this.state();
    return state.kind === 'stale' ? formatAge(state.ageSeconds) : '';
  });

  constructor() {
    // Tick once a second while there is a snapshot to count from; the effect's cleanup stops the
    // timer when the snapshot goes away or the component is destroyed.
    effect((onCleanup) => {
      this.now.set(Date.now());
      if (!this.snapshot()) return;
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
    });
  }
}
