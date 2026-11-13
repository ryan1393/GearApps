import type { RxoExpediteManualRunState } from '@truck-log/shared/contracts';
import type { TruckLogApi } from '@truck-log/web/data-access';
import type { TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import type { Subscription } from 'rxjs';
import type { RxoExpediteStore } from './rxo-expedite.store';

export function isExpediteManualRun(value: unknown): value is RxoExpediteManualRunState {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<RxoExpediteManualRunState>;
  return typeof run.id === 'string' && !!run.id
    && ['QUEUED', 'RUNNING', 'COMPLETE', 'FAILED'].includes(run.status ?? '')
    && typeof run.requestedAt === 'string' && Number.isFinite(Date.parse(run.requestedAt));
}

/** Keeps a confirmed queued request visible while an earlier status poll finishes. */
export class ExpediteScanAction {
  requesting = false;
  error = '';
  private accepted: RxoExpediteManualRunState | null = null;
  private uncertainStatus: RxoExpediteStore['status'] | undefined;
  private request?: Subscription;

  constructor(
    private readonly api: Pick<TruckLogApi, 'runRxoExpediteScanNow'>,
    private readonly auth: Pick<TruckLogAdminAuth, 'canWrite'>,
    private readonly store: RxoExpediteStore,
  ) {}

  get run(): RxoExpediteManualRunState | null {
    const observed = this.store.status?.manualRun;
    if (isExpediteManualRun(observed) && (!this.accepted || observed.id === this.accepted.id
      || Date.parse(observed.requestedAt) >= Date.parse(this.accepted.requestedAt))) return observed;
    return this.accepted;
  }

  get active(): boolean { return ['QUEUED', 'RUNNING'].includes(this.run?.status ?? ''); }

  get disabledReason(): string {
    const status = this.store.status;
    if (!this.auth.canWrite()) return 'Sign in as administrator to start a scan.';
    if (this.requesting) return 'Requesting an Expedite scan.';
    if (this.uncertainStatus !== undefined && status === this.uncertainStatus) return 'Refresh status to confirm the previous request.';
    if (this.active || status?.scheduler?.state === 'EXPORTING') return 'An Expedite scan is already queued or running.';
    if (!status || this.store.stale || Date.now() - this.store.statusReceivedAt > 15000) return 'Refresh Expedite status before starting a scan.';
    if (!status.schedulingEnabled || status.scheduler?.state !== 'WAITING'
      || Date.now() - Date.parse(status.scheduler?.schedulerHeartbeatAt ?? '') > 30000
      || !Number.isFinite(Date.parse(status.scheduler?.schedulerHeartbeatAt ?? ''))
      || !Number.isFinite(Date.parse(status.scheduler?.nextRunAt ?? ''))) return 'The Expedite scheduler must be ready before starting a scan. Check Exporter Health.';
    if (!status.credentials.configured || status.recovery?.requiresCredentials || status.recovery?.requiresInteractiveLogin) return 'Check the saved Expedite login under Settings & Login.';
    if (Date.parse(status.recovery?.cooldownUntil ?? '') > Date.now()) return 'Wait for the connection recovery cooldown to finish.';
    return '';
  }

  get label(): string { return this.requesting ? 'Requesting scan…' : this.active ? 'Scan queued / running…' : 'Run Scan Now'; }

  get message(): string {
    switch (this.run?.status) {
      case 'QUEUED': return 'Expedite scan queued. Waiting for the scheduler to start it.';
      case 'RUNNING': return 'Expedite scan running. The previous verified batch stays available.';
      case 'COMPLETE': return 'Expedite export completed and verified. Check Latest import for database progress.';
      case 'FAILED': return this.run?.error || 'The Expedite scan failed. Open Exporter Health for details; the previous verified batch stays available.';
      default: return '';
    }
  }

  start(): void {
    if (this.disabledReason) return;
    this.requesting = true;
    this.error = '';
    this.uncertainStatus = undefined;
    this.request = this.api.runRxoExpediteScanNow().subscribe({
      next: run => {
        this.requesting = false;
        if (isExpediteManualRun(run)) this.accepted = run;
        else this.notConfirmed();
        this.store.refresh();
      },
      error: () => {
        this.requesting = false;
        this.notConfirmed();
        this.store.refresh();
      },
    });
  }

  destroy(): void { this.request?.unsubscribe(); }

  private notConfirmed(): void {
    this.uncertainStatus = this.store.status;
    this.error = 'The scan request was not confirmed. Refresh status before trying again. Check Exporter Health or Settings & Login if scanning is unavailable.';
  }
}
