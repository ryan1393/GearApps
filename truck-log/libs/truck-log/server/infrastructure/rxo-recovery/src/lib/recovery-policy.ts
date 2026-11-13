import type { RxoConnectionRecoveryInfo } from '@truck-log/shared/contracts';

export type RecoveryRole = 'standard' | 'expedite';
export interface RecoveryObservation { recovery: RxoConnectionRecoveryInfo; requested: boolean; holdCleared?: boolean; requestedAt?: string; scheduler: { state: string; heartbeatAt: string | null; deadlineAt: string | null } | null; }
const MESSAGES: Record<string, string> = {
  READY: 'Queue one connection recovery using the saved login.',
  QUEUED: 'Connection recovery is queued. Authentication has not yet been verified.',
  COOLDOWN: 'A connection recovery was requested recently. Wait before trying again.',
  RETRY_LIMIT: 'The connection recovery limit has been reached. Wait before trying again.',
  CREDENTIALS_MISSING: 'Save the login in Settings & Login before recovering the connection.',
  ALREADY_QUEUED: 'Connection recovery is queued. Authentication has not yet been verified.',
  CREDENTIALS_UNCHANGED: 'Review or update the saved login in Settings & Login before retrying.',
  INTERACTIVE_LOGIN_REQUIRED: 'Complete the required interactive sign-in or access review before retrying.',
  STATE_REVIEW: 'Connection state requires review before recovery can be requested.',
  WORKER_UNAVAILABLE: 'The installed worker or its storage could not be verified. Review the deployment.',
  WORKER_BUSY: 'An RXO scan is already running. Let it finish before requesting recovery.',
  RECOVERY_UNAVAILABLE: 'Connection recovery is temporarily unavailable. Review the worker deployment.',
  CHECKING: 'Checking the worker and its sign-in state…',
};

/**
 * Why the worker could not be verified, in words an administrator can act on. The codes come from
 * RxoRecoveryRuntime.target(); none of the messages carry paths, IDs or secrets.
 */
const WORKER_PROBLEMS: Record<string, string> = {
  WORKER_NOT_FOUND: 'The worker container was not found. Use Restart worker; if it is still missing, run setup on the server.',
  WORKER_DUPLICATE: 'More than one container exists for this worker (for example a leftover one-off run). Remove the extra container on the server, or run setup to replace them with one.',
  WORKER_RELEASE_MISMATCH: 'The worker is from a different Truck Log build than the API. Run setup on the server to rebuild all services together.',
  WORKER_STORAGE_MISMATCH: 'The worker is not attached to the expected data and credential volumes. Run setup on the server.',
  WORKER_DOCKER_UNAVAILABLE: 'Docker on the server did not answer the worker check in time. It is checked again automatically.',
  WORKER_CHECK_FAILED: 'The worker\'s recovery check did not finish. It is checked again automatically; Restart worker can help if it keeps failing.',
};
export function workerProblem(code: string): RxoConnectionRecoveryInfo {
  const info = recoveryInfo('WORKER_UNAVAILABLE');
  info.message = WORKER_PROBLEMS[code] ?? info.message;
  return info;
}
export function recoveryInfo(reason: string, available = false): RxoConnectionRecoveryInfo {
  const safeReason = Object.hasOwn(MESSAGES, reason) ? reason : 'STATE_REVIEW';
  return { available, reason: safeReason, message: MESSAGES[safeReason], requiresCredentials: ['CREDENTIALS_MISSING','CREDENTIALS_UNCHANGED'].includes(safeReason), requiresInteractiveLogin: safeReason === 'INTERACTIVE_LOGIN_REQUIRED', cooldownUntil: null };
}
function date(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
/** Positive allowlist: helper text, errors, secrets, paths and hashes are never forwarded. */
export function recoveryObservation(value: unknown, role: RecoveryRole): RecoveryObservation {
  const v = value as Record<string, any> | null;
  const r = v?.recovery;
  if (!v || v.role !== role || !r || typeof r !== 'object' || Array.isArray(r)) throw new Error('RECOVERY_UNAVAILABLE');
  const reason = typeof r.reason === 'string' ? r.reason : (r.requested === true ? 'QUEUED' : r.available === true ? 'READY' : 'STATE_REVIEW');
  const info = recoveryInfo(reason, r.available === true);
  if (info.reason === 'STATE_REVIEW') info.available = false;
  info.requiresCredentials = info.requiresCredentials || r.requiresCredentials === true;
  info.requiresInteractiveLogin = info.requiresInteractiveLogin || r.requiresInteractiveLogin === true;
  info.cooldownUntil = date(r.cooldownUntil);
  const scheduler = v.scheduler;
  return { recovery: info, requested: r.requested === true, holdCleared: r.holdCleared === true, requestedAt: date(r.requestedAt) || undefined,
    scheduler: scheduler && typeof scheduler === 'object' ? {
      state: typeof scheduler.state === 'string' && /^[A-Z_]{1,40}$/.test(scheduler.state) ? scheduler.state : 'UNKNOWN',
      heartbeatAt: date(scheduler.heartbeatAt), deadlineAt: date(scheduler.deadlineAt),
    } : null };
}
export function liveScheduler(observation: RecoveryObservation, now = Date.now()): boolean {
  const scheduler = observation.scheduler;
  if (!scheduler?.heartbeatAt || !scheduler.deadlineAt) return false;
  const age = now - Date.parse(scheduler.heartbeatAt);
  return age >= -5000 && age < 30000 && Date.parse(scheduler.deadlineAt) > now;
}
export function activeScheduler(observation: RecoveryObservation): boolean {
  return liveScheduler(observation) && ['STARTING','EXPORTING','RUNNING','RECOVERING','STARTING_EXPORT','LAUNCHING','EXPORT','RETRYING','QUEUED'].includes(observation.scheduler!.state);
}
