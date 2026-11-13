/**
 * Late Print Agent results.
 *
 * Guard Shack Print Agent 4.0.7+ keeps each finished result in a durable outbox
 * and re-sends it (same X-Idempotency-Key, identical body) until the server
 * confirms. A print finished within its lease can therefore reach the server
 * after the lease expired (network or heartbeat outage). Such a result is
 * recorded truthfully instead of being forced to an "uncertain" failure:
 *
 * - "In time" means the agent's claim token still matches the job (checked by
 *   the caller; a guard retry clears/rotates the lease token, so a result for an
 *   old attempt is still rejected) and
 *   leased_at - skew <= submittedAt <= lease_expires_at + skew.
 * - Only a FAILED written by the lease monitor (the "uncertain" marker) may be
 *   replaced, exactly once. A FAILED reported by the agent or a human is never
 *   overwritten and PRINTED is never downgraded.
 *
 * Pure functions only (no imports): the contract tests execute this module.
 */

export interface AgentResultTiming {
  leasedAt: unknown;
  leaseExpiresAt: unknown;
  submittedAtMs: number;
  skewMs: number;
}

function epochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime();
  return Number.NaN;
}

/** True when the agent says it finished inside its lease window (± clock skew). */
export function resultSubmittedWithinLease(timing: AgentResultTiming): boolean {
  const leasedAt = epochMs(timing.leasedAt);
  const expiresAt = epochMs(timing.leaseExpiresAt);
  const submitted = timing.submittedAtMs;
  if (![leasedAt, expiresAt, submitted, timing.skewMs].every(Number.isFinite)) return false;
  return submitted >= leasedAt - timing.skewMs && submitted <= expiresAt + timing.skewMs;
}

export type AgentResultDecision =
  /** LEASED: record the agent's outcome (inside the lease, or late but in time). */
  | 'RECORD'
  /** LEASED, lease expired, result out of time: FAILED, outcome uncertain (unchanged behaviour). */
  | 'EXPIRE_UNCERTAIN'
  /** FAILED only by the lease monitor, result in time: replace with the agent's outcome. */
  | 'REPLACE_MONITOR_FAILURE'
  /** Final state already matches the reported outcome: return the stored summary. */
  | 'REPLAY_FINAL'
  /** Final state differs from the reported outcome: reject. */
  | 'CONFLICT_FINAL'
  /** Any other state (QUEUED, PENDING_CONFIRMATION, ...): reject. */
  | 'NOT_LEASED';

export interface AgentResultState {
  status: string;
  leaseExpired: boolean;
  inTime: boolean;
  /** FAILED by the lease monitor and not yet carrying an agent result. */
  expiredByMonitor: boolean;
  success: boolean;
}

/** Decides what an authenticated, claim-verified agent result does to the item. */
export function decideAgentResult(state: AgentResultState): AgentResultDecision {
  if (state.status === 'LEASED') {
    return !state.leaseExpired || state.inTime ? 'RECORD' : 'EXPIRE_UNCERTAIN';
  }
  if (state.status === 'FAILED' && state.expiredByMonitor && state.inTime) {
    return 'REPLACE_MONITOR_FAILURE';
  }
  if (state.status === 'PRINTED' || state.status === 'FAILED') {
    return (state.status === 'PRINTED') === state.success ? 'REPLAY_FINAL' : 'CONFLICT_FINAL';
  }
  return 'NOT_LEASED';
}

/** Visit-history note for a result that replaced the lease monitor's uncertain failure. */
export function lateResultNote(submittedAt: Date, outcome: string): string {
  return (
    `Late Print Agent result: submitted ${submittedAt.toISOString()} within its lease, ` +
    `delivered after the lease monitor had marked the print outcome uncertain; ` +
    `the agent's reported outcome replaces it. ${outcome}`
  );
}
