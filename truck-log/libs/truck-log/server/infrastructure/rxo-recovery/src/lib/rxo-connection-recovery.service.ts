import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RxoConnectionRecoveryInfo, RxoConnectionRecoveryResult } from '@truck-log/shared/contracts';
import { activeScheduler, liveScheduler, recoveryInfo, type RecoveryRole } from './recovery-policy';
import { RxoRecoveryRuntime } from './recovery-runtime';

@Injectable()
export class RxoConnectionRecoveryService {
  private readonly runtime: RxoRecoveryRuntime;
  private readonly flights = new Map<RecoveryRole, Promise<RxoConnectionRecoveryResult>>();
  private readonly statusFlights = new Map<RecoveryRole, Promise<RxoConnectionRecoveryInfo>>();
  private readonly generations = new Map<RecoveryRole, number>();
  private readonly cached = new Map<RecoveryRole, { at: number; value: RxoConnectionRecoveryInfo }>();
  constructor(config: ConfigService) { this.runtime = new RxoRecoveryRuntime(config); }
  isRecovering(role: RecoveryRole): boolean { return this.flights.has(role); }
  status(role: RecoveryRole): Promise<RxoConnectionRecoveryInfo> {
    const cached = this.cached.get(role);
    if (cached && Date.now() - cached.at < 15000) return Promise.resolve(cached.value);
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
      const runtime = this.runtime.withDeadline(4000);
      const target = await runtime.target(role);
      const observed = await runtime.observe(target,'status');
      if (target.restarting || (target.running && activeScheduler(observed))) return recoveryInfo('WORKER_BUSY');
      return observed.recovery;
    } catch { return recoveryInfo('WORKER_UNAVAILABLE'); }
  }
  recover(role: RecoveryRole): Promise<RxoConnectionRecoveryResult> {
    const flight = this.flights.get(role);
    if (flight) return flight;
    // Reserve synchronously before any Docker await. Standard and Expedite remain independent.
    this.invalidateStatus(role);
    const requested = this.performRecovery(role).finally(() => { this.flights.delete(role); this.invalidateStatus(role); });
    this.flights.set(role, requested);
    return requested;
  }
  private invalidateStatus(role: RecoveryRole) {
    this.generations.set(role, (this.generations.get(role) || 0) + 1);
    this.cached.delete(role);
    this.statusFlights.delete(role);
  }
  private denied(info: RxoConnectionRecoveryInfo, status = 409): never {
    throw new HttpException({code: info.reason, ...info}, status);
  }
  private async performRecovery(role: RecoveryRole): Promise<RxoConnectionRecoveryResult> {
    let requestPersisted = false;
    try {
      const runtime = this.runtime.withDeadline(35000);
      const target = await runtime.target(role);
      const before = await runtime.observe(target,'status');
      if (target.restarting || (target.running && activeScheduler(before))) {
        return {status:'ALREADY_RUNNING',message:'An RXO scan is already running. It has been left to finish.'};
      }
      if (!before.recovery.available) this.denied(before.recovery);
      const queued = await runtime.observe(target,'request');
      if (!queued.requested) this.denied(queued.recovery);
      requestPersisted = true;
      // The durable request is now stored. Revalidate identity and scheduler state before lifecycle changes.
      const current = await runtime.target(role);
      if (current.id !== target.id) this.denied(recoveryInfo('WORKER_UNAVAILABLE'),503);
      if (!current.restarting) {
        if (!current.running) await runtime.lifecycle(current,'start');
        else {
          const latest = await runtime.observe(current,'status');
          if (!liveScheduler(latest)) await runtime.lifecycle(current,'restart');
        }
      }
      return {status:'QUEUED',message:'Connection recovery is queued. Check the next login and export result.', ...(queued.requestedAt ? {requestedAt:queued.requestedAt} : {})};
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (requestPersisted) {
        const pending = recoveryInfo('RECOVERY_UNAVAILABLE');
        pending.message = 'Recovery was queued, but the worker could not be confirmed running. Wait before retrying or review the worker deployment.';
        this.denied(pending,503);
      }
      this.denied(recoveryInfo('RECOVERY_UNAVAILABLE'),503);
    }
  }
}
