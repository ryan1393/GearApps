import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RxoConnectionRecoveryInfo, RxoConnectionRecoveryResult, RxoWorkerRestartResult } from '@truck-log/shared/contracts';
import { activeScheduler, liveScheduler, recoveryInfo, workerProblem, type RecoveryRole } from './recovery-policy';
import { RxoRecoveryRuntime } from './recovery-runtime';

/** The failure code a runtime step threw (plain Error message), without relying on instanceof. */
function failureCode(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}

/** A status read is refreshed after this long; until then the last answer is reused. */
const STATUS_FRESH_MS = 15000;
/**
 * Budget for one status read: five Docker lookups plus a helper container started from the full
 * worker image. That start alone takes several seconds on a real host, so this is generous.
 */
const STATUS_BUDGET_MS = 30000;
/** How long the very first status request waits before answering "checking". */
const FIRST_STATUS_WAIT_MS = 3500;

export interface RecoverOptions {
  /**
   * The administrator confirmed they checked RXO (a verification or access step done outside
   * Truck Log, or a temporary unexpected sign-in page): clear that review hold once and retry.
   */
  acknowledgeHold?: boolean;
}

@Injectable()
export class RxoConnectionRecoveryService {
  private readonly runtime: RxoRecoveryRuntime;
  private readonly flights = new Map<RecoveryRole, Promise<unknown>>();
  private readonly statusFlights = new Map<RecoveryRole, Promise<RxoConnectionRecoveryInfo>>();
  private readonly generations = new Map<RecoveryRole, number>();
  private readonly cached = new Map<RecoveryRole, { at: number; value: RxoConnectionRecoveryInfo }>();
  constructor(config: ConfigService) { this.runtime = new RxoRecoveryRuntime(config); }
  isRecovering(role: RecoveryRole): boolean { return this.flights.has(role); }

  /**
   * Never makes a status page wait for Docker: the last known answer is returned at once and a
   * stale one is refreshed in the background. Only the very first request waits, briefly, and then
   * answers CHECKING instead of reporting a slow check as a broken worker.
   */
  status(role: RecoveryRole): Promise<RxoConnectionRecoveryInfo> {
    const cached = this.cached.get(role);
    const flight = cached && Date.now() - cached.at < STATUS_FRESH_MS ? null : this.refreshStatus(role);
    if (cached) return Promise.resolve(cached.value);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checking = new Promise<RxoConnectionRecoveryInfo>(resolve => {
      timer = setTimeout(() => resolve(recoveryInfo('CHECKING')), FIRST_STATUS_WAIT_MS);
    });
    return Promise.race([flight!, checking]).finally(() => clearTimeout(timer));
  }
  private refreshStatus(role: RecoveryRole): Promise<RxoConnectionRecoveryInfo> {
    const active = this.statusFlights.get(role);
    if (active) return active;
    const generation = this.generations.get(role) || 0;
    const flight = this.readStatus(role).then(value => {
      if ((this.generations.get(role) || 0) === generation) this.cached.set(role, {at: Date.now(), value});
      return value;
    }).finally(() => { if (this.statusFlights.get(role) === flight) this.statusFlights.delete(role); });
    this.statusFlights.set(role, flight);
    return flight;
  }
  private async readStatus(role: RecoveryRole): Promise<RxoConnectionRecoveryInfo> {
    try {
      const runtime = this.runtime.withDeadline(STATUS_BUDGET_MS);
      const target = await runtime.target(role);
      const observed = await runtime.observe(target,'status');
      if (target.restarting || (target.running && activeScheduler(observed))) return recoveryInfo('WORKER_BUSY');
      return observed.recovery;
    } catch (error) { return workerProblem(failureCode(error)); }
  }

  recover(role: RecoveryRole, options: RecoverOptions = {}): Promise<RxoConnectionRecoveryResult> {
    return this.exclusive(role, () => this.performRecovery(role, options));
  }

  /**
   * Restart (or start) the worker container: the administrator's way to unstick a worker. The same
   * Compose identity, release and volume checks as recovery apply first, so only the installed
   * Truck Log worker can be restarted. A scan in progress is stopped; the scheduler retries it and
   * the previous verified data stays available. Sign-in holds and rate limits are not touched.
   */
  restartWorker(role: RecoveryRole): Promise<RxoWorkerRestartResult> {
    return this.exclusive(role, async () => {
      try {
        const runtime = this.runtime.withDeadline(45000);
        const target = await runtime.target(role);
        if (target.restarting) return {status:'ALREADY_RESTARTING' as const, message:'The worker is already restarting.'};
        await runtime.lifecycle(target, target.running ? 'restart' : 'start');
        return target.running
          ? {status:'RESTARTED' as const, message:'The worker restarted. Its scheduler resumes on its own; the previous verified data stays available.'}
          : {status:'STARTED' as const, message:'The worker was stopped and has been started.'};
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code = failureCode(error);
        const problem = code.startsWith('WORKER_')
          ? workerProblem(code)
          : {...recoveryInfo('RECOVERY_UNAVAILABLE'), message: 'Docker did not confirm the restart. Check the worker on the server.'};
        this.denied(problem, 503);
      }
    });
  }

  /** One recovery or restart per worker at a time; Standard and Expedite stay independent. */
  private exclusive<T>(role: RecoveryRole, run: () => Promise<T>): Promise<T> {
    const flight = this.flights.get(role);
    if (flight) return flight as Promise<T>;
    // Reserve synchronously before any Docker await.
    this.invalidateStatus(role);
    const started = run().finally(() => { this.flights.delete(role); this.invalidateStatus(role); });
    this.flights.set(role, started);
    return started;
  }
  private invalidateStatus(role: RecoveryRole) {
    this.generations.set(role, (this.generations.get(role) || 0) + 1);
    this.cached.delete(role);
    this.statusFlights.delete(role);
  }
  private denied(info: RxoConnectionRecoveryInfo, status = 409): never {
    throw new HttpException({code: info.reason, ...info}, status);
  }
  private async performRecovery(role: RecoveryRole, options: RecoverOptions): Promise<RxoConnectionRecoveryResult> {
    let requestPersisted = false;
    try {
      const runtime = this.runtime.withDeadline(60000);
      const target = await runtime.target(role);
      const before = await runtime.observe(target,'status');
      if (target.restarting || (target.running && activeScheduler(before))) {
        return {status:'ALREADY_RUNNING',message:'An RXO scan is already running. It has been left to finish.'};
      }
      const acknowledging = !before.recovery.available && options.acknowledgeHold === true
        && before.recovery.reason === 'INTERACTIVE_LOGIN_REQUIRED';
      if (!before.recovery.available && !acknowledging) this.denied(before.recovery);
      const queued = await runtime.observe(target, acknowledging ? 'acknowledge' : 'request');
      if (!queued.requested) this.denied(queued.recovery);
      requestPersisted = true;
      // The durable request is now stored. Revalidate identity and scheduler state before lifecycle changes.
      const current = await runtime.target(role);
      if (current.id !== target.id) this.denied(workerProblem('WORKER_NOT_FOUND'),503);
      if (!current.restarting) {
        if (!current.running) await runtime.lifecycle(current,'start');
        else {
          const latest = await runtime.observe(current,'status');
          if (!liveScheduler(latest)) await runtime.lifecycle(current,'restart');
        }
      }
      return {status:'QUEUED',
        message: queued.holdCleared
          ? 'Sign-in hold cleared and one recovery queued. Check the next login and export result.'
          : 'Connection recovery is queued. Check the next login and export result.',
        ...(queued.requestedAt ? {requestedAt:queued.requestedAt} : {})};
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (requestPersisted) {
        const pending = recoveryInfo('RECOVERY_UNAVAILABLE');
        pending.message = 'Recovery was queued, but the worker could not be confirmed running. Wait before retrying or use Restart worker.';
        this.denied(pending,503);
      }
      const code = failureCode(error);
      this.denied(code.startsWith('WORKER_') ? workerProblem(code) : recoveryInfo('RECOVERY_UNAVAILABLE'),503);
    }
  }
}
