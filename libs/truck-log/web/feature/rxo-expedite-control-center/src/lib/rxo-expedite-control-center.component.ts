import { formatPlantDate } from '@truck-log/web/domain';
import { TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import { TruckLogAdminAccessComponent } from '@truck-log/web/auth/admin';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StaleDataNoticeComponent, ToastService, jumpToSection, rememberedFlag, PlantDatePipe } from '@truck-log/web/ui';
import { TruckLogApi, rxoRecoveryErrorMessage, rxoRecoveryWaitFeedback } from '@truck-log/web/data-access';
import { Subscription } from 'rxjs';
import { expediteFailureDetail, expediteFailureTime } from './rxo-expedite/expedite-failure-display';
import { RxoExpediteComponent } from './rxo-expedite/rxo-expedite.component';
import { RxoExpediteStore, type ExpediteShipmentsResponse, type ExpediteStatus } from './rxo-expedite/rxo-expedite.store';
import { ExpediteScanAction } from './rxo-expedite/expedite-scan-action';

type ExpediteMainTab = 'data' | 'health' | 'settings';

@Component({
  selector: 'truck-log-rxo-expedite-control-center',
  standalone: true,
  imports: [CommonModule, RouterLink, RxoExpediteComponent, StaleDataNoticeComponent, TruckLogAdminAccessComponent, PlantDatePipe],
  // One Expedite poll per page, shared by the KPI cards and every tab.
  providers: [RxoExpediteStore],
  template: `
  <tl-admin-access></tl-admin-access>
  <div class="tl-rxo" [class.is-focused]="!summaryOpen">
    <header class="dana-page-header">
      <div>
        <h1>RXO Expedite Control Center</h1>
        <p>Fort Wayne RXO Expedite freight on the move, exporter health, database import and scan controls.</p>
      </div>
      <div class="dana-actions">
        <span class="dana-muted" *ngIf="lastUpdated">Updated {{lastUpdated | plantDate:'shortTime'}}</span>
        <button class="dana-btn" type="button" (click)="refreshAll()">Refresh</button>
        <button class="dana-btn dana-btn-primary" type="button" [disabled]="!!scan.disabledReason || recoveryBusy"
                [attr.aria-busy]="scan.requesting" [title]="scan.disabledReason || 'Request a fresh Expedite export'"
                (click)="scan.start()">{{scan.label}}</button>
      </div>
    </header>

    <tl-stale-data-notice [stale]="!!status && store.stale" [lastUpdated]="lastUpdated" subject="RXO Expedite"></tl-stale-data-notice>

    <div class="dana-alert" *ngIf="scan.message" [class.dana-alert-danger]="scan.run?.status === 'FAILED'" role="status" aria-live="polite">{{scan.message}}</div>
    <div class="dana-alert dana-alert-danger" *ngIf="scan.error" role="alert">{{scan.error}}</div>

    <section class="dana-alert tl-rxo-activity" [attr.data-state]="integrationState" role="status" aria-live="polite">
      <span class="dana-status-badge" [attr.data-tone]="integrationTone">{{integrationStatus}}</span>
      <span class="tl-rxo-activity-detail" [title]="integrationDetail">{{integrationDetail}}</span>
      <!-- Not announced: the time changes on every 5 s poll; only real status changes are read out. -->
    <span class="dana-muted dana-nowrap" aria-hidden="true">{{integrationUpdated}}</span>
    </section>

    <!-- Recovery notice: one compact strip, shown only while recovery can help (see showRecoveryPanel). -->
    <section class="dana-alert dana-alert-warning tl-rxo-recovery" aria-labelledby="expedite-recovery-title" *ngIf="showRecoveryPanel">
      <div class="tl-rxo-recovery-row">
        <p><b id="expedite-recovery-title">{{recoveryBusy || recoveryMessage ? 'RXO Expedite connection recovery.' : 'RXO Expedite connection needs recovery.'}}</b> {{connectionRecoveryDetail}}</p>
        <div class="dana-actions" *ngIf="adminAuth.canWrite(); else recoveryAdminSignIn">
          <button class="dana-btn dana-btn-sm dana-btn-primary" type="button" *ngIf="canAcknowledgeHold" [disabled]="recoveryBusy || workerRestarting" (click)="recoverConnection(true)">{{recoveryBusy ? 'Retrying…' : 'Retry sign-in'}}</button>
          <button class="dana-btn dana-btn-sm dana-btn-primary" type="button" *ngIf="!canAcknowledgeHold" [disabled]="recoveryBusy || scanRunning || scan.active || scan.requesting || !recoveryAvailable || workerRestarting" [attr.aria-busy]="recoveryBusy" (click)="recoverConnection()">{{recoveryBusy ? 'Requesting recovery…' : 'Recover connection'}}</button>
          <button class="dana-btn dana-btn-sm" type="button" [disabled]="recoveryBusy || workerRestarting" [attr.aria-busy]="workerRestarting" (click)="restartWorker()">{{workerRestarting ? 'Restarting…' : 'Restart worker'}}</button>
          <button class="dana-btn dana-btn-sm" type="button" [disabled]="recoveryBusy" (click)="openRecoverySettings()">Settings &amp; Login</button>
        </div>
        <ng-template #recoveryAdminSignIn><a class="dana-btn dana-btn-sm dana-btn-primary" routerLink="/admin/login" [queryParams]="{ returnTo: '/rxo-expedite' }">Sign in to recover</a></ng-template>
      </div>
      <p class="tl-rxo-recovery-note" *ngIf="recoveryLoginRequired && !canAcknowledgeHold">The saved Expedite login was rejected or locked. Update it in Settings &amp; Login; the new login is tried on the next scan.</p>
    <p class="tl-rxo-recovery-note" *ngIf="canAcknowledgeHold">RXO asked for MFA, approval or an interactive sign-in, or showed an unexpected sign-in page, so automatic sign-in paused. Check RXO in a browser and finish any verification, then use <b>Retry sign-in</b>. If it was a temporary RXO error page, you can retry right away.</p>
      <p class="tl-rxo-recovery-note" *ngIf="recoveryWait as wait"><b>{{wait.title}}</b> {{wait.detail}} <time [attr.datetime]="wait.until">{{wait.resumeLabel}}</time> <span aria-live="off">({{wait.remaining}} remaining)</span>.</p>
      <p class="tl-rxo-recovery-note dana-field-error" role="alert" *ngIf="recoveryError">{{recoveryError}}</p>
      <p class="tl-rxo-recovery-note" role="status" *ngIf="recoveryMessage">{{recoveryMessage}}</p>
    </section>

    <div class="dana-alert dana-alert-danger" *ngIf="pageError">
      <b>RXO Expedite status unavailable.</b> {{pageError}}
    </div>

    <section class="tl-stack tl-rxo-alerts" aria-label="RXO Expedite attention required" aria-live="polite"
             *ngIf="status && (timerStatusStale || needsReview || databaseNeedsReview)">
      <div class="dana-alert dana-alert-warning" *ngIf="timerStatusStale">
        <b>Status stale.</b> The countdown is paused until a fresh Expedite scheduler heartbeat and API response arrive.
      </div>
      <div class="dana-alert dana-alert-danger" *ngIf="needsReview">
        <b>{{scanRunning ? 'Previous Expedite attempt failed.' : 'Latest Expedite attempt failed.'}}</b> {{status.acquisition.lastError || status.scheduler?.lastErrorCode || 'The latest export needs attention.'}}
        <p>Failure completed: {{latestFailureAt ? displayTime(latestFailureAt) : 'Time not reported'}}. Attempt started: {{displayTime(status.acquisition.lastAttemptAt)}}.</p>
        <p>{{latestFailureDetail}}</p>
        <p>The previous verified batch stays available; the last successful export and import below refer to that retained batch.</p>
        <button class="dana-btn dana-btn-sm" type="button" (click)="activeTab='health'; healthTabButton.focus()">Open Exporter Health</button>
      </div>
      <div class="dana-alert dana-alert-danger" *ngIf="databaseNeedsReview">
        <b>Expedite import needs review.</b> {{status.database?.errorMessage || 'The latest database mirror did not complete.'}}
        The previous complete batch stays available.
      </div>
      <div class="dana-actions">
        <button class="dana-btn dana-btn-sm" type="button" (click)="activeTab='health'; healthTabButton.focus()">View timer diagnostics</button>
      </div>
    </section>

    <div class="tl-rxo-kpis" [class.is-compact]="!summaryOpen" id="rxo-expedite-summary">
    <section class="dana-kpi-grid" aria-label="RXO Expedite scan and import summary">
      <div class="dana-kpi-card" [attr.data-tone]="needsReview && !waitingForNextScan ? 'danger' : (needsReview || timerStatusStale ? 'warning' : null)">
        <button type="button" class="tl-kpi-jump" (click)="jumpTo('health')" [attr.aria-label]="'Timer status: open Exporter Health'"></button>
        <div class="dana-kpi-label">{{timerTitle}}</div>
        <div class="dana-kpi-value" aria-live="off">{{timerLabel}}</div>
        <div class="dana-kpi-note">{{schedulerStateLabel}} · {{scan.run?.status === 'RUNNING' ? 'manual' : 'scheduled'}}</div>
      </div>
      <div class="dana-kpi-card">
        <button type="button" class="tl-kpi-jump" (click)="jumpTo('health')" [attr.aria-label]="'Last successful export: open Exporter Health'"></button>
        <div class="dana-kpi-label">Last successful export</div>
        <div class="dana-kpi-value tl-rxo-kpi-time">{{displayTime(status?.acquisition?.lastSuccessfulExport)}}</div>
        <div class="dana-kpi-note">Batch {{status?.acquisition?.sourceBatchId || status?.scheduler?.lastSourceBatchId || 'not reported'}}</div>
      </div>
      <div class="dana-kpi-card" [attr.data-tone]="databaseNeedsReview ? 'warning' : null">
        <button type="button" class="tl-kpi-jump" (click)="jumpTo('health')" [attr.aria-label]="'Latest import: open Exporter Health'"></button>
        <div class="dana-kpi-label">Latest import</div>
        <div class="dana-kpi-value tl-rxo-kpi-time">{{displayTime(status?.database?.importedAt || null)}}</div>
        <div class="dana-kpi-note">{{status?.database?.state || (status?.databaseIngestionEnabled ? 'Not reported' : 'Migration required')}} · {{status?.database?.lastImportedBatch || status?.database?.latestVerifiedBatch || 'no batch'}}</div>
      </div>
      <div class="dana-kpi-card">
        <button type="button" class="tl-kpi-jump" (click)="jumpTo('settings')" [attr.aria-label]="'Automatic scan: open Settings and Login'"></button>
        <div class="dana-kpi-label">Automatic scan</div>
        <div class="dana-kpi-value tl-rxo-kpi-time">Every {{status?.scheduler?.intervalMinutes ?? 30}} min</div>
        <div class="dana-kpi-note">Own scheduler · never overlaps</div>
      </div>
    </section>

    <section class="dana-kpi-grid" aria-label="Expedite shipment counts">
      <div class="dana-kpi-card"><button type="button" class="tl-kpi-jump" (click)="jumpTo('data')" [attr.aria-label]="'Expedite shipments: open the shipments table'"></button><div class="dana-kpi-label">Expedite shipments</div><div class="dana-kpi-value">{{shipmentCount}}</div><div class="dana-kpi-note">Latest verified batch</div></div>
      <div class="dana-kpi-card" [attr.data-tone]="criticalCount ? 'warning' : null"><button type="button" class="tl-kpi-jump" (click)="jumpTo('data')" [attr.aria-label]="'Critical: open the shipments table'"></button><div class="dana-kpi-label">Critical</div><div class="dana-kpi-value">{{criticalCount}}</div><div class="dana-kpi-note">Critical Expedite shipments</div></div>
      <div class="dana-kpi-card" [attr.data-tone]="delayedCount ? 'warning' : null"><button type="button" class="tl-kpi-jump" (click)="jumpTo('data')" [attr.aria-label]="'Delayed / watch: open the shipments table'"></button><div class="dana-kpi-label">Delayed / watch</div><div class="dana-kpi-value">{{delayedCount}}</div><div class="dana-kpi-note">ETA status needs attention</div></div>
      <div class="dana-kpi-card"><button type="button" class="tl-kpi-jump" (click)="jumpTo('data')" [attr.aria-label]="'Documents ready: open the shipments table'"></button><div class="dana-kpi-label">Documents ready</div><div class="dana-kpi-value">{{documentsReadyCount}}</div><div class="dana-kpi-note">With an active driver document</div></div>
    </section>
    </div>

    <div class="tl-rxo-tabbar">
    <div class="dana-tabs tl-rxo-tabs" role="tablist" aria-label="RXO Expedite Control Center sections">
      <button #dataTabButton id="rxo-expedite-tab-data" class="dana-tab" type="button" role="tab" aria-controls="rxo-expedite-panel-data"
              [class.is-active]="activeTab === 'data'" [attr.aria-selected]="activeTab === 'data'" [attr.tabindex]="activeTab === 'data' ? 0 : -1"
              (click)="activeTab='data'" (keydown.arrowright)="healthTabButton.focus(); $event.preventDefault()" (keydown.arrowleft)="settingsTabButton.focus(); $event.preventDefault()"
              (keydown.home)="dataTabButton.focus(); $event.preventDefault()" (keydown.end)="settingsTabButton.focus(); $event.preventDefault()">Data</button>
      <button #healthTabButton id="rxo-expedite-tab-health" class="dana-tab" type="button" role="tab" aria-controls="rxo-expedite-panel-health"
              [class.is-active]="activeTab === 'health'" [attr.aria-selected]="activeTab === 'health'" [attr.tabindex]="activeTab === 'health' ? 0 : -1"
              (click)="activeTab='health'" (keydown.arrowright)="settingsTabButton.focus(); $event.preventDefault()" (keydown.arrowleft)="dataTabButton.focus(); $event.preventDefault()"
              (keydown.home)="dataTabButton.focus(); $event.preventDefault()" (keydown.end)="settingsTabButton.focus(); $event.preventDefault()">Exporter Health</button>
      <button #settingsTabButton id="rxo-expedite-tab-settings" class="dana-tab" type="button" role="tab" aria-controls="rxo-expedite-panel-settings"
              [class.is-active]="activeTab === 'settings'" [attr.aria-selected]="activeTab === 'settings'" [attr.tabindex]="activeTab === 'settings' ? 0 : -1"
              (click)="activeTab='settings'" (keydown.arrowright)="dataTabButton.focus(); $event.preventDefault()" (keydown.arrowleft)="healthTabButton.focus(); $event.preventDefault()"
              (keydown.home)="dataTabButton.focus(); $event.preventDefault()" (keydown.end)="settingsTabButton.focus(); $event.preventDefault()">Settings &amp; Login</button>
    </div>
    <button type="button" class="dana-btn dana-btn-ghost dana-btn-sm" aria-controls="rxo-expedite-summary" [attr.aria-expanded]="summaryOpen" (click)="toggleSummary()">{{summaryOpen ? 'Compact summary' : 'Full summary'}}</button>
    </div>

    <section *ngIf="activeTab === 'data'" id="rxo-expedite-panel-data" role="tabpanel"
             aria-labelledby="rxo-expedite-tab-data" tabindex="0" class="dana-panel tl-fill">
      <div class="dana-panel-header">
        <div>
          <h2>Expedite shipments <span class="dana-count-badge">{{shipments?.rowCount ?? shipmentCount}}</span></h2>
          <small>Latest verified Expedite batch, mirrored into Truck Log.</small>
        </div>
      </div>
      <tl-rxo-expedite class="tl-scroll" mode="data"></tl-rxo-expedite>
    </section>

    <div *ngIf="activeTab === 'health'" id="rxo-expedite-panel-health" role="tabpanel"
         aria-labelledby="rxo-expedite-tab-health" tabindex="0" class="tl-fill tl-scroll">
      <!-- Always reachable: restart the worker even when the recovery strip is hidden. -->
      <div class="dana-alert tl-rxo-recovery" *ngIf="adminAuth.canWrite()">
        <div class="tl-rxo-recovery-row">
          <p><b>RXO Expedite worker container.</b> Restarting stops a scan in progress (the scheduler retries it); verified data, the saved login and sign-in pauses are unchanged.</p>
          <div class="dana-actions"><button class="dana-btn dana-btn-sm" type="button" [disabled]="recoveryBusy || workerRestarting" [attr.aria-busy]="workerRestarting" (click)="restartWorker()">{{workerRestarting ? 'Restarting…' : 'Restart worker'}}</button></div>
        </div>
      </div>
      <tl-rxo-expedite mode="health"></tl-rxo-expedite>
    </div>

    <div *ngIf="activeTab === 'settings'" id="rxo-expedite-panel-settings" role="tabpanel"
         aria-labelledby="rxo-expedite-tab-settings" tabindex="0" class="tl-fill tl-scroll">
      <tl-rxo-expedite *ngIf="adminAuth.canWrite(); else expediteSettingsSignIn" mode="settings"></tl-rxo-expedite>
      <ng-template #expediteSettingsSignIn>
        <section class="dana-panel">
          <div class="dana-panel-header"><div><h2>Settings &amp; login</h2><small>Expedite scan schedule and Expedite login</small></div></div>
          <div class="dana-panel-body tl-stack">
            <p class="dana-note">Sign in as administrator to edit the Expedite scan schedule and login.</p>
            <div class="dana-actions"><a class="dana-btn dana-btn-primary" routerLink="/admin/login" [queryParams]="{ returnTo: '/rxo-expedite' }">Sign in as administrator</a></div>
          </div>
        </section>
      </ng-template>
    </div>
  </div>`
})
export class RxoExpediteControlCenterComponent implements OnInit, OnDestroy {
  readonly scan: ExpediteScanAction;
  activeTab: ExpediteMainTab = 'data';
  /** Full KPI tiles (true) or the slim summary strip (false); remembered in this browser. */
  private readonly summaryPreference = rememberedFlag('rxo-expedite.summary-open', true);
  summaryOpen = this.summaryPreference.get();
  recoveryBusy = false;
  recoveryMessage = '';
  workerRestarting = false;
  recoveryError = '';
  private recoveryLoginBlocked = false;
  private recoveryBlockedStatus: ExpediteStatus | null = null;
  private recoveryRequest?: Subscription;
  private destroyed = false;
  clockNow = Date.now();

  private clockTimer?: number;

  constructor(
    readonly store: RxoExpediteStore,
    public readonly adminAuth: TruckLogAdminAuth,
    private readonly api: TruckLogApi,
    private readonly toast: ToastService,
  ) { this.scan = new ExpediteScanAction(api, adminAuth, store); }

  get status(): ExpediteStatus | null { return this.store.status; }
  get shipments(): ExpediteShipmentsResponse | null { return this.store.shipments; }
  get statusReceivedAt(): number { return this.store.statusReceivedAt; }
  /** Only shown before any status has been confirmed; later failures show the stale notice instead. */
  get pageError(): string { return this.store.status ? '' : this.store.statusError; }
  /** Advances only when a refresh succeeded. */
  get lastUpdated(): Date | null { return this.store.lastUpdated; }

  ngOnInit(): void {
    this.clockTimer = window.setInterval(() => {
      this.clockNow = Date.now();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.recoveryRequest?.unsubscribe();
    this.scan.destroy();
    if (this.clockTimer) window.clearInterval(this.clockTimer);
  }

  refreshAll(): void {
    this.store.refresh();
  }

  get connectionRecoveryNeeded() {
    const reason = this.status?.recovery?.reason;
    return !!this.status && ((!!reason && reason !== 'READY' && reason !== 'CHECKING') || this.recoveryLoginRequired || this.recoveryCooldownActive || this.authenticationNeedsReview
      || /STOPPED|STOPPING/.test(this.schedulerState));
  }
  /**
   * The recovery strip appears only while it can help: a recovery is running or failed, the login
   * needs attention, or the integration is not healthy and a recovery is needed. Once Expedite data
   * is current again it disappears, including when the server still reports a recovery reason
   * (for example a helper that cannot verify the worker) while everything else works.
   */
  get showRecoveryPanel(): boolean {
    if (this.recoveryBusy || this.recoveryError || this.recoveryLoginRequired) return true;
    // No status at all: the worker may be stuck, so keep Restart worker within reach.
    if (!this.status && !!this.pageError) return true;
    if (this.integrationState === 'healthy') return false;
    return this.connectionRecoveryNeeded || !!this.recoveryMessage;
  }
  /** A review-type sign-in hold an administrator may clear with Retry sign-in (not a rejected password). */
  get canAcknowledgeHold(): boolean {
    return this.status?.recovery?.reason === 'INTERACTIVE_LOGIN_REQUIRED' && !this.recoveryCooldownActive;
  }
  /** Restart the worker container (stops a running scan; the scheduler retries it). */
  restartWorker() {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in as administrator to restart the RXO Expedite worker.'); return; }
    if (this.workerRestarting || this.recoveryBusy || this.destroyed) return;
    if (!window.confirm('Restart the RXO Expedite worker container?\n\nA scan in progress is stopped and retried by the scheduler. The last verified data stays available, and the saved login and sign-in pauses are unchanged.')) return;
    this.workerRestarting = true;
    this.recoveryError = '';
    this.api.restartRxoExpediteWorker().subscribe({
      next: result => {
        if (this.destroyed) return;
        this.workerRestarting = false;
        this.toast.success(result.message, result.status === 'STARTED' ? 'Worker started' : 'Worker restarted');
        this.store.refresh();
      },
      error: error => {
        if (this.destroyed) return;
        this.workerRestarting = false;
        this.recoveryError = error?.error?.message || 'The worker restart was not confirmed. Check the worker on the server.';
        this.store.refresh();
      },
    });
  }
  get recoveryLoginRequired() {
    const info = this.status?.recovery;
    return !!(info?.requiresCredentials || info?.requiresInteractiveLogin)
      || (this.recoveryLoginBlocked && this.status === this.recoveryBlockedStatus);
  }
  get recoveryWait() { return rxoRecoveryWaitFeedback(this.status?.recovery, this.clockNow); }
  get recoveryCooldownActive() { return Date.parse(this.status?.recovery?.cooldownUntil || '') > this.clockNow; }
  get recoveryAvailable() {
    return !!this.status && this.status.recovery?.available !== false
      && !this.recoveryCooldownActive && !this.recoveryLoginRequired;
  }
  get connectionRecoveryDetail() {
    // The note under the strip explains what to check and offers Retry sign-in.
    if (this.canAcknowledgeHold) return 'Automatic sign-in is paused.';
    if (!this.status && this.pageError) return 'Expedite status could not be read. If the worker is stuck, Restart worker can help.';
    if (this.needsReview && !this.authenticationNeedsReview && this.waitingForNextScan) {
      return 'The latest acquisition attempt failed. Open Exporter Health for its recorded stage and cause. The scheduler is still waiting for the next scan; a connection reset is not a general export retry.';
    }
    return this.status?.recovery?.message || 'A controlled recovery reopens Expedite with its saved login and requests a fresh scan. The previous verified batch stays available.';
  }
  toggleSummary() { this.setSummaryOpen(!this.summaryOpen); }
  private setSummaryOpen(open: boolean) { this.summaryOpen = open; this.summaryPreference.set(open); }

  /** A KPI tile was clicked: open its tab, shrink the summary so the table gets the height, focus the panel. */
  jumpTo(tab: ExpediteMainTab) {
    this.activeTab = tab;
    this.setSummaryOpen(false);
    jumpToSection(`rxo-expedite-panel-${tab}`);
  }

  openRecoverySettings() {
    this.activeTab = 'settings';
    document.getElementById('rxo-expedite-tab-settings')?.focus();
  }
  /**
   * acknowledgeHold: the administrator confirmed they checked RXO, so a verification, access-review
   * or unexpected-sign-in-page hold is cleared once and one recovery is queued (server-enforced limits apply).
   */
  recoverConnection(acknowledgeHold = false) {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in as administrator to recover the Expedite connection.'); return; }
    if (acknowledgeHold) {
      if (!this.canAcknowledgeHold || this.recoveryBusy || this.destroyed) return;
      if (!window.confirm('Retry the RXO sign-in now?\n\nUse this after you have checked RXO yourself: any verification or access step is done, or the sign-in page error was temporary. Truck Log tries once; if RXO still shows the same page, sign-in pauses again.')) return;
    } else if (this.recoveryLoginRequired) { this.openRecoverySettings(); return; }
    if (!acknowledgeHold && (this.recoveryBusy || this.scanRunning || this.scan.active || this.scan.requesting || !this.recoveryAvailable || this.destroyed)) return;
    this.recoveryBusy = true;
    this.recoveryError = '';
    this.recoveryMessage = '';
    this.recoveryRequest = this.api.recoverRxoExpediteConnection(acknowledgeHold).subscribe({
      next: result => {
        if (this.destroyed) return;
        this.recoveryBusy = false;
        if (!result || !['QUEUED', 'ALREADY_RUNNING'].includes(result.status)) {
          this.recoveryError = 'Recovery could not be confirmed. Refresh the status before trying again.';
        } else {
          this.recoveryMessage = result.status === 'ALREADY_RUNNING'
            ? 'A recovery scan is already queued or running. Wait for a verified export; the connection is not yet confirmed.'
            : (acknowledgeHold ? 'Sign-in hold cleared and one retry requested. ' : 'Recovery requested. ')
              + 'Wait for a successful verified export before treating the connection as restored. Previous verified data stays available.';
        }
        this.store.refresh();
      },
      error: error => {
        if (this.destroyed) return;
        this.recoveryBusy = false;
        this.recoveryLoginBlocked = !!(error?.error?.requiresCredentials || error?.error?.requiresInteractiveLogin);
        this.recoveryBlockedStatus = this.status;
        this.recoveryError = rxoRecoveryErrorMessage(error);
        if (this.recoveryLoginBlocked) this.openRecoverySettings();
        this.store.refresh();
      },
    });
  }

  get shipmentCount(): number {
    return Number(
      this.status?.database?.rowCount
      ?? this.shipments?.rowCount
      ?? this.status?.acquisition?.shipmentCount
      ?? 0,
    );
  }

  get criticalCount(): number {
    return (this.shipments?.shipments ?? []).filter((row) => row.critical === true).length;
  }

  get delayedCount(): number {
    return (this.shipments?.shipments ?? []).filter((row) =>
      /risk|late|past due|delayed|exception|watch|possible delay/i.test(String(row.etaStatus ?? '')),
    ).length;
  }

  get documentsReadyCount(): number {
    return (this.shipments?.shipments ?? []).filter((row) =>
      Boolean(row.driverDocument && row.driverDocument.status !== 'NO_DOCUMENT'),
    ).length;
  }

  get schedulerState(): string {
    return String(this.status?.scheduler?.state ?? 'NOT_STARTED').toUpperCase();
  }

  get scanRunning(): boolean {
    return this.schedulerState === 'EXPORTING';
  }

  get needsReview(): boolean {
    return Boolean(
      this.status?.acquisition?.lastError
      || this.status?.scheduler?.lastErrorCode,
    );
  }

  get waitingForNextScan(): boolean {
    return this.status?.schedulingEnabled === true && !this.recoveryLoginRequired && this.schedulerState === 'WAITING'
      && Number.isFinite(Date.parse(this.status.scheduler?.nextRunAt || ''));
  }
  get authenticationNeedsReview(): boolean {
    return this.recoveryLoginRequired || (!this.waitingForNextScan
      && /RXO_AUTH_/.test([this.status?.acquisition.lastError, this.status?.scheduler?.lastErrorCode].join(' ')));
  }
  get latestFailureAt(): string | null {
    return expediteFailureTime(this.status?.acquisition.lastError ? this.status.acquisition.completedAt : null, this.status?.scheduler?.lastFailureAt);
  }
  get latestFailureDetail(): string { return expediteFailureDetail(this.status?.acquisition.diagnostic); }

  get databaseNeedsReview(): boolean {
    return String(this.status?.database?.state ?? '').toUpperCase() === 'FAILED'
      || Boolean(this.status?.database?.errorMessage);
  }

  get apiAgeMs(): number {
    return this.statusReceivedAt
      ? Math.max(0, Date.now() - this.statusReceivedAt)
      : Number.POSITIVE_INFINITY;
  }

  get heartbeatAgeMs(): number {
    const value = this.status?.scheduler?.schedulerHeartbeatAt;
    return value
      ? Math.max(0, this.clockNow - Date.parse(value))
      : Number.POSITIVE_INFINITY;
  }

  get timerStatusStale(): boolean {
    if (!this.status || this.apiAgeMs > 15000) return true;
    return this.status.schedulingEnabled && this.heartbeatAgeMs > 30000;
  }

  get effectiveNextRunAt(): number | null {
    // Do not invent a countdown for an auth hold, disabled schedule, or stopped worker.
    return this.waitingForNextScan ? Date.parse(this.status?.scheduler?.nextRunAt || '') : null;
  }

  get timerTitle(): string {
    if (!this.status && !this.pageError) return 'Checking Expedite status';
    if (this.timerStatusStale) return 'Timer status';
    if (this.activeExportVerified) return 'Scan elapsed';
    if (this.scanRunning) return 'Scan elapsed';
    if (this.waitingForNextScan) return 'Next scan in';
    return this.authenticationNeedsReview ? 'Sign-in paused' : 'Scan schedule';
  }

  get timerLabel(): string {
    if (!this.status && !this.pageError) return '--:--';
    if (this.timerStatusStale) return 'STALE';
    if (this.activeExportVerified) {
      const started = Date.parse(this.status?.scheduler?.currentStartedAt ?? '');
      return this.formatClockDuration(
        Number.isFinite(started) ? Math.max(0, this.clockNow - started) : 0,
      );
    }
    if (this.scanRunning) {
      const started = Date.parse(this.status?.scheduler?.currentStartedAt ?? '');
      return this.formatClockDuration(
        Number.isFinite(started) ? Math.max(0, this.clockNow - started) : 0,
      );
    }

    const next = this.effectiveNextRunAt;
    if (!next) return ['STOPPED', 'STOPPING', 'NOT_STARTED'].includes(this.schedulerState) ? 'STOPPED' : 'PAUSED';
    return this.formatClockDuration(Math.max(0, next - this.clockNow));
  }

  get timerDetail(): string {
    if (!this.status && !this.pageError) return 'Waiting for the first live Expedite status response.';
    if (this.timerStatusStale) {
      return 'Waiting for a fresh Expedite scheduler heartbeat and API status response.';
    }
    if (this.activeExportVerified) {
      return 'Expedite export is running. The previous verified PostgreSQL batch remains available.';
    }
    if (this.scanRunning) {
      return 'Expedite reports an active export but its current health needs verification.';
    }

    const next = this.effectiveNextRunAt;
    if (next) {
      return `Next automatic Expedite scan ${this.displayTime(new Date(next).toISOString())}`;
    }
    return this.authenticationNeedsReview ? 'Automatic scans are paused for sign-in review.' : 'No next scan is currently reported. Check Exporter Health.';
  }

  get schedulerStateLabel(): string {
    return this.schedulerState.replaceAll('_', ' ');
  }

  get activeExportVerified(): boolean {
    return this.scanRunning && !this.timerStatusStale
      && !this.status?.scheduler?.lastErrorCode;
  }

  get integrationState(): string {
    if (!this.status) return this.pageError ? 'degraded' : 'idle';
    if (this.timerStatusStale) return 'warning';
    if (this.activeExportVerified) return 'working';
    if (this.needsReview || this.databaseNeedsReview) return 'warning';
    if (this.status?.databaseIngestionEnabled && this.status?.database?.state === 'COMPLETE') return 'healthy';
    return 'idle';
  }

  get integrationTone(): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
    const state = this.integrationState;
    if (state === 'healthy') return 'success';
    if (state === 'warning' || state === 'degraded') return 'warning';
    if (state === 'working') return 'info';
    return 'neutral';
  }

  get integrationStatus(): string {
    if (!this.status) return this.pageError ? 'RXO Expedite status unavailable' : 'Checking RXO Expedite status…';
    if (this.timerStatusStale) return 'RXO Expedite data available - timer status is stale';
    if (this.activeExportVerified) return 'RXO Expedite export is running';
    if (this.needsReview) return 'RXO Expedite export needs review';
    if (this.databaseNeedsReview) return 'RXO Expedite PostgreSQL import needs review';
    if (this.scanRunning) return 'RXO Expedite export status needs verification';
    if (this.status?.databaseIngestionEnabled && this.status?.database?.state === 'COMPLETE') {
      return 'RXO Expedite data is current';
    }
    return 'RXO Expedite integration is waiting';
  }

  get integrationDetail(): string {
    if (!this.status) return this.pageError
      ? 'Expedite status could not be confirmed. Check the warning and retry Refresh.'
      : 'Waiting for the first live Expedite status response.';
    if (this.timerStatusStale) {
      return 'The countdown is paused because the Expedite scheduler heartbeat or API refresh is stale. Open Timer Diagnostics for details.';
    }
    if (this.activeExportVerified) {
      return this.needsReview || this.databaseNeedsReview
        ? 'An Expedite export is active. An earlier export or import issue is still shown in the detailed warnings until resolved.'
        : 'Truck Log is refreshing RXO Expedite data. The previous verified PostgreSQL batch remains available while the export runs.';
    }
    if (this.needsReview) {
      if (this.authenticationNeedsReview) return 'Sign-in needs review. The previous verified batch remains available. Use Recover connection or Settings & Login as indicated above.';
      return this.waitingForNextScan
        ? 'The latest attempt failed; the previous verified batch remains available. Open Exporter Health for the failure time, stage and cause. The scheduler is waiting for the next scan.'
        : 'The latest attempt failed; the previous verified batch remains available. Open Exporter Health for the failure details and scheduler status.';
    }
    if (this.databaseNeedsReview) {
      return 'The previous complete PostgreSQL mirror remains available while the latest import needs attention.';
    }
    if (this.scanRunning) {
      return 'Expedite reports a running export, but its latest scheduler heartbeat or error state requires verification.';
    }
    if (this.status?.databaseIngestionEnabled && this.status?.database?.state === 'COMPLETE') {
      return 'The latest verified RXO Expedite batch is available in PostgreSQL and the dedicated scheduler heartbeat is current.';
    }
    return 'No Expedite export is running. Truck Log is waiting for the next dedicated scheduled cycle.';
  }

  get integrationUpdated(): string {
    return this.lastUpdated
      ? `Updated ${formatPlantDate(this.lastUpdated, 'h:mm:ss a')}`
      : 'Waiting for status';
  }

  displayTime(value: string | null | undefined): string {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Timestamp requires review';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  }

  private formatClockDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${mm}:${ss}`
      : `${mm}:${ss}`;
  }
}
