import { TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import { TruckLogAdminAccessComponent } from '@truck-log/web/auth/admin';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  RxoControlStatusData,
  RxoImportStatusData,
} from '@truck-log/shared/contracts';
import { forkJoin } from 'rxjs';
import { Poller, TruckLogApi, createPoller } from '@truck-log/web/data-access';
import { StaleDataNoticeComponent, ToastService } from '@truck-log/web/ui';
import { buildRxoControlView, type RxoControlView } from './rxo-control-center.presenter';
import { RxoDataStore } from './rxo-data.store';
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
  imports: [CommonModule, RouterLink, StaleDataNoticeComponent, TruckLogAdminAccessComponent, RxoDataTableComponent, RxoSettingsPanelComponent],
  // The Data tab keeps its dataset, filters and page while other tabs are open.
  providers: [RxoDataStore],
  templateUrl: './rxo-control-center.component.html',
})
export class RxoControlCenterComponent implements OnInit, OnDestroy {
  activeTab: MainTab = 'data';
  lastUpdated: Date | null = null;
  importStatus: RxoImportStatusData | null = null;
  control: RxoControlStatusData | null = null;
  /** Scan schedule and login being edited on the Settings tab. */
  readonly settingsForm = emptyRxoSettingsForm();
  clockNow = Date.now();
  statusReceivedAt = 0;
  serverClockOffsetMs = 0;
  timerDiagnosticsOpen = false;
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
    forkJoin({
      importStatus: this.api.rxoStatus(),
      control: this.api.rxoControl(),
    }).subscribe({
      next: ({ importStatus, control }) => {
        this.importStatus = importStatus;
        this.statusRefreshFailed = false;
        this.lastUpdated = new Date();
        this.applyControl(control);
        this.busy = false;
        this.data.loadData();
        this.controlPoller.schedule();
      },
      error: (error) => {
        this.busy = false;
        this.statusRefreshFailed = true;
        this.publishSystemStatus(false, true);
        this.toast.error(error?.error?.message || 'Could not load RXO Control Center.');
        this.controlPoller.schedule();
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
      this.api.rxoStatus().subscribe({
        next: (status) => { this.importStatus = status; this.updateView(); this.data.loadData(); },
        // The scan finished but the import summary could not be read: show the data and mark status stale.
        error: () => { this.statusRefreshFailed = true; this.data.loadData(); },
      });
    } else if (next !== previous && next === 'FAILED') {
      this.toast.error(control.manualRun?.error || 'RXO manual scan/import failed.');
    } else {
      this.api.rxoStatus().subscribe({ next: (status) => { this.importStatus = status; this.updateView(); }, error: () => { this.statusRefreshFailed = true; } });
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
    if (updateInputs) applyRxoSettings(this.settingsForm, control);
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

  runScanNow() {
    if (!this.adminAuth.canWrite()) { this.toast.error('Sign in to Truck Log Admin before changing RXO settings or starting a scan.'); return; }
    this.busy = true;
    this.api.runRxoScanNow().subscribe({
      next: () => { this.busy = false; this.toast.success('RXO scan queued. This screen will track export, sync, and import automatically.'); this.refreshControl(false); },
      error: (error) => { this.busy = false; this.toast.error(error?.error?.message || 'Could not start RXO scan.'); },
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
