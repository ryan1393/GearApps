import { BaseEntity } from '../common/entity';
import { Machine } from './machine';

/** Live PLC/Fanuc I/O snapshot for a machine. Column names mirror the Fanuc addresses. */
export interface MachineFanucVariable extends BaseEntity {
  x06_7_frt_dr_closed: boolean;
  x01_2_start_cycle: boolean;
  y03_2_stack_inCycle: boolean;
  machine_id: string;
  machine?: Machine;
  /**
   * Seconds the current cycle has been running. Lapper Read sends it measured on its own clock;
   * reads return it as of the moment of the read. Null when the machine is not in cycle or the
   * cycle's start was not seen (collector started mid-cycle).
   */
  cycle_elapsed_s?: number | null;
  /** Seconds since the collector last reported this machine; null before any report. Read only. */
  reported_age_s?: number | null;
}
/** Lapper Read reports every machine at least this often, even when nothing changed. */
export const LIVE_REPORT_INTERVAL_S = 30;
/** A snapshot older than this is stale: the collector, or its link to the machine, has stopped. */
export const LIVE_STALE_AFTER_S = 90;
export type CreateMachineFanucVariable = Pick<
  MachineFanucVariable,
  'x06_7_frt_dr_closed' | 'x01_2_start_cycle' | 'y03_2_stack_inCycle' | 'machine_id'
>;
export type UpdateMachineFanucVariable = Partial<
  Pick<
    MachineFanucVariable,
    'x06_7_frt_dr_closed' | 'x01_2_start_cycle' | 'y03_2_stack_inCycle' | 'cycle_elapsed_s'
  >
>;

/** What a live machine snapshot says about the current cycle, at a moment in the browser. */
export type LiveCycleState =
  /** No snapshot recorded for the machine yet. */
  | { kind: 'none' }
  /** The collector has not reported for longer than LIVE_STALE_AFTER_S. */
  | { kind: 'stale'; ageSeconds: number }
  /** In cycle for `seconds`. */
  | { kind: 'running'; seconds: number }
  /** In cycle, but its start was not seen (the collector started mid-cycle). */
  | { kind: 'running-unknown' }
  | { kind: 'idle' };

/**
 * The live cycle state of `snapshot`, read at `receivedAtMs` and shown at `nowMs` (both browser
 * clock, Date.now()). The snapshot's ages are on the server's clock; only the time since it was
 * received is added here, so the browser's clock never has to agree with the server's.
 */
export function liveCycleState(
  snapshot: Pick<MachineFanucVariable, 'y03_2_stack_inCycle' | 'cycle_elapsed_s' | 'reported_age_s'> | null | undefined,
  receivedAtMs: number,
  nowMs: number,
): LiveCycleState {
  if (!snapshot) return { kind: 'none' };
  const sinceReceived = Math.max(0, (nowMs - receivedAtMs) / 1000);
  // A snapshot from a collector that never reported a heartbeat (older versions) has no age.
  if (typeof snapshot.reported_age_s === 'number') {
    const age = snapshot.reported_age_s + sinceReceived;
    if (age > LIVE_STALE_AFTER_S) return { kind: 'stale', ageSeconds: age };
  }
  if (!snapshot.y03_2_stack_inCycle) return { kind: 'idle' };
  if (typeof snapshot.cycle_elapsed_s !== 'number' || !Number.isFinite(snapshot.cycle_elapsed_s))
    return { kind: 'running-unknown' };
  return { kind: 'running', seconds: snapshot.cycle_elapsed_s + sinceReceived };
}

/** A running time in whole seconds: 1:23, or 1:02:03 past an hour. */
export function formatRunningTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** How long ago, for a stale snapshot, in whole minutes passed: 2 min, 1 h 5 min. */
export function formatAge(seconds: number): string {
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
