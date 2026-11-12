import { TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import { TruckLogAdminAccessComponent } from '@truck-log/web/auth/admin';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  RxoControlStatusData,
  RxoImportStatusData,
} from '@truck-log/shared/contracts';
import { forkJoin, Subscription } from 'rxjs';
import { Poller, TruckLogApi, createPoller, rxoRecoveryErrorMessage, rxoRecoveryWaitFeedback } from '@truck-log/web/data-access';
import { StaleDataNoticeComponent, ToastService, jumpToSection, rememberedFlag, PlantDatePipe } from '@truck-log/web/ui';
import { buildRxoControlView, type RxoControlView } from './rxo-control-center.presenter';
import { RxoDataStore, type DataKind } from './rxo-data.store';
import { RxoDataTableComponent } from './rxo-data-table.component';
import { RxoSettingsPanelComponent, applyRxoSettings, emptyRxoSettingsForm } from './rxo-settings-panel.component';

type MainTab = 'data' | 'health' | 'settings';

type RxoSystemStatusEventDetail = {
  clear?: boolean;
  phase?: string;
  active?: boolean;
  failed?: boolean;
  stale?: boolean;
  controlAvailable?: boolean;
  exporterRunning?: boolean;
  detail?: string;
  receivedAt?: number;
};

const RXO_SYSTEM_STATUS_EVENT = 'truck-log-rxo-system-status';

@Component({
  selector: 'truck-log-rxo-control-center',
  standalone: true,
  imports: [CommonModule, RouterLink, StaleDataNoticeComponent, TruckLogAdminAccessComponent, RxoDataTableComponent, RxoSettingsPanelComponent, PlantDatePipe],
  // The Data tab keeps its dataset, filters and page while other tabs are open.
  providers: [RxoDataStore],
  templateUrl: './rxo-control-center.component.html',
})
export class RxoControlCenterComponent implements OnInit, OnDestroy {
  activeTab: MainTab = 'data';
  recoveryBusy = false;
  recoveryMessage = '';
  recoveryError = '';
  private recoveryLoginBlocked = false;
  private recoveryBlockedStatus: RxoControlStatusData | null = null;
  private recoveryRequest?: Subscription;
  private scanRequest?: Subscription;
  private destroyed = false;
  private refreshAllRequest?: Subscription;
  private statusRequestSeq = 0;
  lastUpdated: Date | null = null;
  importStatus: RxoImportStatusData | null = null;
  control: RxoControlStatusData | null = null;
  /** Scan schedule and login being edited on the Settings tab. */
  readonly settingsForm = emptyRxoSettingsForm();
  clockNow = Date.now();
  statusReceivedAt = 0;
  serverClockOffsetMs = 0;
  timerDiagnosticsOpen = false;
  /** Full KPI tiles (true) or the slim summary strip (false); remembered in this browser. */
  private readonly summaryPreference = rememberedFlag('rxo.summary-open', true);
  summaryOpen = this.summaryPreference.get();
  /** The latest background status refresh failed; the page shows older status. */
  statusRefreshFailed = false;
  /** Status presentation, recomputed once per status update and clock tick. */
  view: RxoControlView;
  private busyValue = false;
  private pageClockTimer?: number;
  private readonly destroyRef = inject(DestroyRef);
  /** Exporter/scheduler status every 5 s through the shared non-overlapping poller. */
  private controlPoller!: Poller<RxoControlStatusData>;
  private showNextControlError = false;

  constructor(
    public readonly api: TruckLogApi,
    private readonly toast: ToastService,
    public readonly adminAuth: TruckLogAdminAuth,
    private readonly data: RxoDataStore,
  ) {
    this.view = this.computeView();
  }

  get busy() { return this.busyValue; }
  set busy(value: boolean) { this.busyValue = value; this.updateView(); }
  setBusy(value: boolean) { this.busy = value; }

  ngOnInit() {
    this.controlPoller = createPoller({
      intervalMs: 5000,
      destroyRef: this.destroyRef,
      start: false,
      load: () => this.api.rxoControl(),
      next: (control) => this.controlRefreshed(control),
      error: (error, { manual }) => this.controlRefreshFailed(error, manual && this.showNextControlError),
    });
    this.refreshAll();
    this.data.loadRxoOrderLocationNames(true);
    this.pageClockTimer = window.setInterval(() => {
      this.clockNow = Date.now();
      this.updateView();
    }, 1000);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.refreshAllRequest?.unsubscribe();
    this.recoveryRequest?.unsubscribe();
    this.scanRequest?.unsubscribe();
    if (this.pageClockTimer) {
      window.clearInterval(this.pageClockTimer);
    }
    this.settingsForm.credentialPassword = '';
    this.publishSystemStatus(true);
  }

  private computeView(): RxoControlView {
    return buildRxoControlView({
      control: this.control,
      importStatus: this.importStatus,
      clockNow: this.clockNow,
      now: Date.now(),
      statusReceivedAt: this.statusReceivedAt,
      serverClockOffsetMs: this.serverClockOffsetMs,
      busy: this.busyValue,
      lastUpdated: this.lastUpdated,
      fallbackSettings: {
        syncIntervalMinutes: this.settingsForm.settingsInterval,
        maxScanDurationMinutes: this.settingsForm.settingsMaxScanDuration,
        noProgressTimeoutMinutes: this.settingsForm.settingsNoProgressTimeout,
      },
    });
  }

  private updateView() {
    this.view = this.computeView();
  }

  lastImportValue(key: string): unknown { return this.importStatus?.lastImport?.[key]; }

  refreshAll() {
    this.busy = true;
    this.refreshAllRequest?.unsubscribe();
    this.refreshAllRequest = forkJoin({
      importStatus: this.api.rxoStatus(),
      control: this.api.rxoControl(),
    }).subscribe({
      next: ({ importStatus, control }) => {
        if (this.destroyed) return;
        this.statusRequestSeq += 1;
        this.importStatus = importStatus;
        this.statusRefreshFailed = false;
        this.lastUpdated = new Date();
        this.applyControl(control);
        this.busy = false;
        this.data.loadData();
        this.controlPoller.schedule();
      },
      error: (error) => {
        if (this.destroyed) return;
        this.busy = false;
        this.statusRefreshFailed = true;
        this.publishSystemStatus(false, true);
        this.toast.error(error?.error?.message || 'Could not load RXO Control Center.');
        // The data tables come from their own endpoint; load them even when status failed.
        this.data.loadData();
        this.controlPoller.schedule();
      },
    });
  }

  /** Background import-status reads can overlap; only the newest one may update the page. */
  private refreshImportStatus(after?: () => void, failed?: () => void) {
    const seq = ++this.statusRequestSeq;
    this.api.rxoStatus().subscribe({
      next: (status) => {
        if (this.destroyed || seq !== this.statusRequestSeq) return;
        this.importStatus = status;
        this.updateView();
        after?.();
      },
      error: () => {
        if (this.destroyed || seq !== this.statusRequestSeq) return;
        this.statusRefreshFailed = true;
        failed?.();
      },
    });
  }

  /** Refresh exporter/scheduler status now (after an action); background refreshes continue every 5 s. */
  refreshControl(showError = true) {
    this.showNextControlError = showError;
    this.controlPoller.refresh();
  }

  private controlRefreshed(control: RxoControlStatusData) {
    const previous = this.control?.manualRun?.status ?? '';
    this.statusRefreshFailed = false;
    this.lastUpdated = new Date();
    this.applyControl(control, false);
    const next = control.manualRun?.status ?? '';
    if (next !== previous && (next === 'COMPLETE' || next === 'PARTIAL')) {
      if (next === 'PARTIAL') this.toast.warning('RXO import needs review. Open Import details for the affected dataset and direction.');
      else this.toast.success('RXO scan, sync, and PostgreSQL import completed.');
      // The scan finished; if the import summary cannot be read, show the data and mark status stale.
      this.refreshImportStatus(() => this.data.loadData(), () => this.data.loadData());
    } else if (next !== previous && next === 'FAILED') {
      this.toast.error(control.manualRun?.error || 'RXO manual scan/import failed.');
    } else {
      this.refreshImportStatus();
    }
  }

  /** A failed background refresh keeps the last status on screen, marked stale; "Updated" does not advance. */
  private controlRefreshFailed(error: unknown, showError: boolean) {
    this.statusRefreshFailed = true;
    this.publishSystemStatus(false, true);
    if (showError) {
      this.toast.error((error as { error?: { message?: string } })?.error?.message || 'Could not refresh RXO exporter health.');
    }
  }

  private applyControl(control: RxoControlStatusData, updateInputs = true) {
    const receivedAt = Date.now();
    const serverEpoch =
      Number(control.serverEpochMs) ||
      Date.parse(control.serverTime ?? '');

    this.statusReceivedAt = receivedAt;
    this.serverClockOffsetMs = Number.isFinite(serverEpoch)
      ? serverEpoch - receivedAt
      : 0;
    this.control = control;
    if (updateInputs || !this.settingsForm.loaded) applyRxoSettings(this.settingsForm, control);
    this.updateView();
    this.publishSystemStatus();
  }

  private publishSystemStatus(clear = false, forceStale = false) {
    const view = this.view;
    const detail: RxoSystemStatusEventDetail = clear
      ? { clear: true, receivedAt: Date.now() }
      : {
          phase: view.activeTimerPhase,
          active: view.activeTimerPhase !== 'IDLE',
          failed:
            view.scanNeedsReview
            || this.control?.manualRun?.status === 'FAILED'
            || (String(this.control?.exporterHealth?.status ?? '').toLowerCase() === 'error'
              && !view.scanRecoveryActive),
          stale: forceStale || view.timerStatusStale,
          controlAvailable: Boolean(this.control?.controlAvailable),
          exporterRunning: Boolean(this.control?.exporterRunning),
          detail: view.integrationDetail,
          receivedAt: Date.now(),
        };

    window.dispatchEvent(
      new CustomEvent<RxoSystemStatusEventDetail>(RXO_SYSTEM_STATUS_EVENT, {
        detail,
      }),
    );
  }

  get connectionRecoveryNeeded() {
    const control = this.control;
    const reason = control?.recovery?.reason;
    return !!control && ((!!reason && reason !== 'READY') || this.recoveryLoginRequired || this.recoveryCooldownActive || this.view.scanNeedsReview
      || /AUTH|STOPPED|NEEDS_REVIEW/.test([control.scheduler?.status, control.scheduler?.currentPhase].join(' ').toUpperCase())
      || /RXO_AUTH_/.test(String(control.exporterHealth?.lastError || control.scheduler?.lastError || '')));
  }
  get recoveryLoginRequired() {
    const info = this.control?.recovery;
    return !!(info?.requiresCredentials || info?.requiresInteractiveLogin)
      || (this.recoveryLoginBlocked && this.control === this.recoveryBlockedStatus);
  }
  get recoveryWait() { return rxoRecoveryWaitFeedback(this.control?.recovery, this.clockNow); }
  get recoveryCooldownActive() { return Date.parse(this.control?.recovery?.cooldownUntil || '') > this.clockNow; }
  get recoveryAvailable() {
    return !!this.control?.controlAvailable && this.control.recovery?.available !== false
      && !this.recoveryCooldownActive && !this.recoveryLoginRequired;
  }
  get connectionRecoveryDetail() {
    return this.control?.recovery?.message || 'A controlled recovery reopens RXO with the saved login and requests a fresh scan. The previous verified data stays available.';
  }
  toggleSummary() { this.setSummaryOpen(!this.summaryOpen); }
  private setSummaryOpen(open: boolean) { this.summaryOpen = open; this.summaryPreference.set(open); }

  /**
   * A KPI tile was clicked: open the tab (and dataset) it summarizes, shrink the summary
   * to its slim strip so the table gets the height, and move focus to that panel.
   */
  jumpTo(tab: MainTab, kind?: DataKind, diagnostics = false) {
    this.activeTab = tab;
    if (kind && this.data.dataKind !== kind) this.data.changeKind(kind);
    if (diagnostics) this.timerDiagnosticsOpen = true;
    this.setSummaryOpen(false);
    jumpToSection(`rxo-panel-${tab}`);
  }

  openRecoverySettings() {
    this.activeTab = 'settings';
    document.getElementById('rxo-tab-settings')?.focus();
  }
  recoverConnection() {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in as administrator to recover the RXO connection.'); return; }
    if (this.recoveryLoginRequired) { this.openRecoverySettings(); return; }
    if (this.recoveryBusy || this.busy || this.view.scanRunning || !this.recoveryAvailable || this.destroyed) return;
    this.recoveryBusy = true;
    this.busy = true;
    this.recoveryError = '';
    this.recoveryMessage = '';
    this.recoveryRequest = this.api.recoverRxoConnection().subscribe({
      next: result => {
        if (this.destroyed) return;
        this.recoveryBusy = false;
        this.busy = false;
        if (!result || !['QUEUED', 'ALREADY_RUNNING'].includes(result.status)) {
          this.recoveryError = 'Recovery could not be confirmed. Refresh the status before trying again.';
        } else {
          this.recoveryMessage = result.status === 'ALREADY_RUNNING'
            ? 'A recovery scan is already queued or running. Wait for a verified export; the connection is not yet confirmed.'
            : 'Recovery requested. Wait for a successful verified export before treating the connection as restored. Previous verified data stays available.';
        }
        this.refreshControl(false);
      },
      error: error => {
        if (this.destroyed) return;
        this.recoveryBusy = false;
        this.busy = false;
        this.recoveryLoginBlocked = !!(error?.error?.requiresCredentials || error?.error?.requiresInteractiveLogin);
        this.recoveryBlockedStatus = this.control;
        this.recoveryError = rxoRecoveryErrorMessage(error);
        if (this.recoveryLoginBlocked) this.openRecoverySettings();
        this.refreshControl(false);
      },
    });
  }

  runScanNow() {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in to Truck Log Admin before changing RXO settings or starting a scan.'); return; }
    if (this.destroyed || this.busy || this.recoveryBusy || this.view.scanRunning || !this.control?.exporterRunning) return;
    this.busy = true;
    this.scanRequest = this.api.runRxoScanNow().subscribe({
      next: run => {
        if (this.destroyed) return;
        this.busy = false;
        if (run?.id && ['QUEUED', 'EXPORTING', 'SYNCING', 'IMPORTING'].includes(run.status)) {
          if (this.control) this.applyControl({ ...this.control, manualRun: run });
          this.toast.success('RXO scan queued. This screen will track export, sync, and import automatically.');
        } else this.toast.error('The scan request was not confirmed. Refresh status before trying again.');
        this.refreshControl(false);
      },
      error: (error) => { if (this.destroyed) return; this.busy = false; this.toast.error(error?.error?.message || 'Could not start RXO scan.'); },
    });
  }

  syncLatest() {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in to Truck Log Admin before changing RXO settings or starting a scan.'); return; }
    this.busy = true;
    this.api.syncRxoLatestNow().subscribe({
      next: () => { this.busy = false; this.toast.success('Current RXO export is being verified, synced, and imported.'); this.refreshControl(false); },
      error: (error) => { this.busy = false; this.toast.error(error?.error?.message || 'Could not sync the current RXO export.'); },
    });
  }
}
