import { Injectable, OnDestroy } from '@angular/core';
import { timeout } from 'rxjs';
import type { DriverPrintItemRecord, DriverPrintPackageRecord, RxoDriverDocumentSummary, TruckVisitRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';

const RXO_RACE_PACKAGE_DISCOVERY_MS = 10 * 60 * 1000;
/** Status polling starts at 2.5 s and backs off to at most 30 s between checks. */
const PRINT_STATUS_POLL_START_MS = 2500;
const PRINT_STATUS_POLL_MAX_MS = 30_000;
/** With no status change for this long, stop polling and tell the guard the printer is not responding. */
export const PRINT_STATUS_POLL_LIMIT_MS = 3 * 60 * 1000;
/** Consecutive failed status reads before the guard is told Truck Log cannot be reached. */
const PRINT_STATUS_UNREACHABLE_AFTER = 3;

/**
 * Driver Print Package tracking for the most recent check-in: status polling
 * (bounded, with backoff), guard confirmation and per-item retries. Every
 * response is checked against the current visit/generation so late answers for
 * an earlier check-in never change what the guard sees now.
 */
@Injectable()
export class DriverPrintTracker implements OnDestroy {
  lastVisitId: number | null = null;
  lastVisit: TruckVisitRecord | null = null;
  lastRxoDocument: RxoDriverDocumentSummary | null = null;
  lastPrintPackage: DriverPrintPackageRecord | null = null;
  printPackageLoading = false;
  reportingDockResult = false;
  retryingDockPrint = false;
  retryingRxoPrint = false;
  recoveringItemId = '';
  private readonly recoveryKeys = new Map<string, string>();
  /** Polling stopped after PRINT_STATUS_POLL_LIMIT_MS without a status change. */
  printerNotResponding = false;
  /**
   * Truck Log itself could not be reached for print status (network or API down). Shown instead of
   * "printer not responding", so the guard does not go and check a printer that is working.
   */
  printStatusUnreachable = false;
  private pollErrors = 0;
  private lastGuardActionKey = '';
  private packagePollTimer?: number;
  private packageDiscoveryDeadline = 0;
  private packageContextGeneration = 0;
  private pollAttempts = 0;
  private pollSince = 0;
  private pollStatusKey = '';

  constructor(private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  ngOnDestroy() {
    if (this.packagePollTimer) window.clearTimeout(this.packagePollTimer);
    this.packageContextGeneration += 1;
  }

  /** Track the print package of a visit that was just checked in. */
  startTracking(visit: TruckVisitRecord, guardActionKey: string, rxoDocument: RxoDriverDocumentSummary | null, rxoSelection: boolean) {
    this.lastVisitId = visit.id;
    this.lastVisit = visit;
    this.lastRxoDocument = rxoDocument;
    this.lastPrintPackage = visit.driverPrintPackage ?? null;
    // Preserve the visit capability for every exact RXO check-in. A
    // concurrent Materials upload can create the print package just after
    // this response, and the guard must still be able to confirm/retry it.
    this.rememberGuardActionKey(visit.id, guardActionKey);
    this.packageDiscoveryDeadline = rxoSelection && !this.lastPrintPackage
      ? Date.now() + RXO_RACE_PACKAGE_DISCOVERY_MS
      : 0;
    if (this.lastPrintPackage) this.schedulePackageRefresh();
    else if (rxoSelection) this.refreshDriverPrintPackage(visit.id, true);
  }

  get dockPrintItem(): DriverPrintItemRecord | null {
    return this.lastPrintPackage?.items.find((item) => item.itemType === 'DOCK_ASSIGNMENT') ?? null;
  }

  get rxoPrintItem(): DriverPrintItemRecord | null {
    return this.lastPrintPackage?.items.find((item) => item.itemType === 'RXO_DOCUMENT') ?? null;
  }

  get driverPrintComplete() {
    return Boolean(this.lastPrintPackage?.items.length)
      && this.lastPrintPackage!.items.every((item) => item.status === 'PRINTED');
  }

  get driverPrintNeedsAttention() {
    return Boolean(this.lastPrintPackage?.items.some((item) => item.status === 'FAILED'));
  }

  get driverPrintOutcome() {
    if (this.lastPrintPackage?.automaticDockAssignment) {
      if (this.lastPrintPackage.items.some(item => item.cancelled)) return 'A queued print was cancelled. It will not print automatically. Open the slip manually or use Records & Paperwork for RXO documents.';
      if (this.driverPrintNeedsAttention) return 'Automatic printing needs attention. Inspect the physical printer before retrying a failed item.';
      if (this.driverPrintComplete) return 'All included documents were submitted to the gate printer.';
      return 'Automatic gate printing is queued or in progress. Do not create another check-in.';
    }

    const dock = this.dockPrintItem?.status;
    const rxo = this.rxoPrintItem?.status;
    if (dock === 'PRINTED' && rxo === 'FAILED') return 'Dock Assignment printed — RXO document failed.';
    if (dock === 'FAILED' && rxo === 'PRINTED') return 'RXO document printed — Dock Assignment failed.';
    if (dock === 'PRINTED' && rxo === 'PRINTED') return 'Dock Assignment and RXO document printed.';
    if (dock === 'FAILED' && rxo === 'FAILED') return 'Both print items need attention.';
    if (dock === 'PENDING_CONFIRMATION') return 'Confirm the Dock Assignment result below.';
    if (rxo === 'QUEUED' && this.lastRxoDocument?.agentOnline === false) {
      return 'Dock Assignment is open — RXO document is waiting for the Print Agent.';
    }
    return 'Driver Print Package is in progress.';
  }

  printItemLabel(item: DriverPrintItemRecord) {
    return item.itemType === 'DOCK_ASSIGNMENT' ? 'Dock Assignment Slip' : 'RXO Driver Document';
  }

  printItemStatusLabel(item: DriverPrintItemRecord) {
    if (item.cancelled) return item.replacementPackageId ? 'Replaced by a new print job' : 'Cancelled before printing';
    const labels: Record<DriverPrintItemRecord['status'], string> = {
      PENDING_CONFIRMATION: 'Awaiting guard confirmation',
      QUEUED: 'Queued for Print Agent',
      LEASED: 'Printing',
      PRINTED: 'Printed',
      FAILED: 'Failed',
    };
    if (this.lastPrintPackage?.automaticDockAssignment && item.status === 'PRINTED') return 'Submitted to printer';
    return labels[item.status];
  }

  confirmDockPrint(printed: boolean) {
    const printPackage = this.lastPrintPackage;
    if (!printPackage || this.dockPrintItem?.status !== 'PENDING_CONFIRMATION' || this.reportingDockResult || this.recoveringItemId) return;
    const visitId = this.lastVisitId;
    const generation = this.packageContextGeneration;

    const guardActionKey = this.guardActionKey();
    if (!guardActionKey) {
      this.toast.error('This browser session no longer has the original check-in action key. Use an authorized reprint from Records.', 'Print action unavailable');
      return;
    }
    let error: string | undefined;
    if (printed) {
      if (!window.confirm('Confirm that the Dock Assignment Slip printed successfully.')) return;
    } else {
      const reason = window.prompt(
        'What went wrong with the Dock Assignment Slip?',
        'The printer did not produce a usable slip.',
      );
      if (reason === null) return;
      error = reason.trim() || 'Guard reported that the Dock Assignment Slip did not print.';
    }

    this.reportingDockResult = true;
    this.api.confirmDockAssignmentPrint(
      printPackage.packageId,
      printed ? 'PRINTED' : 'FAILED',
      this.api.newIdempotencyKey(),
      guardActionKey,
      error,
    ).subscribe({
      next: (result) => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return;
        this.reportingDockResult = false;
        this.applyDriverPrintPackage(result, visitId, generation);
        if (printed) this.toast.success('Dock Assignment print confirmed.', 'Print result saved');
        else this.toast.warning('Dock Assignment failure recorded. The truck visit remains saved.', 'Print needs attention');
      },
      error: (response) => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return;
        this.reportingDockResult = false;
        this.toast.error(response?.error?.message || 'Could not save the Dock Assignment print result.', 'Print result not saved');
      },
    });
  }

  retryRxoDocument() {
    const printPackage = this.lastPrintPackage;
    if (!printPackage || this.rxoPrintItem?.status !== 'FAILED' || this.rxoPrintItem.cancelled || this.retryingRxoPrint || this.recoveringItemId) return;
    const visitId = this.lastVisitId;
    const generation = this.packageContextGeneration;

    const guardActionKey = this.guardActionKey();
    if (!guardActionKey) {
      this.toast.error('This browser session no longer has the original check-in action key. Use an authorized reprint from Records.', 'Retry unavailable');
      return;
    }
    if (printPackage.automaticDockAssignment && !window.confirm('Inspect the printer first. Continue only if the RXO paperwork needs another physical copy.')) return;
    this.retryingRxoPrint = true;
    this.api.retryRxoDriverDocument(printPackage.packageId, this.api.newIdempotencyKey(), guardActionKey).subscribe({
      next: (result) => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return;
        this.retryingRxoPrint = false;
        this.applyDriverPrintPackage(result, visitId, generation);
        this.toast.success('Only the failed RXO document was queued again.', 'RXO document retry queued');
      },
      error: (response) => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return;
        this.retryingRxoPrint = false;
        this.toast.error(response?.error?.message || 'Could not retry the RXO document.', 'Retry failed');
      },
    });
  }

  retryDockAssignment() {
    const printPackage = this.lastPrintPackage;
    if (!printPackage || this.dockPrintItem?.status !== 'FAILED' || this.dockPrintItem.cancelled || this.retryingDockPrint || this.recoveringItemId) return;
    const visitId = this.lastVisitId;
    const generation = this.packageContextGeneration;
    const guardActionKey = this.guardActionKey();
    if (!guardActionKey) {
      this.toast.error('This browser session no longer has the original check-in action key.', 'Dock retry unavailable');
      return;
    }
    if (printPackage.automaticDockAssignment) {
      if (!window.confirm('Inspect the printer first. Continue only if this Dock Assignment needs another physical copy. Do not retry when the outcome is still uncertain.')) return;
      this.retryingDockPrint = true;
      this.api.retryDockAssignmentPrint(printPackage.packageId, this.api.newIdempotencyKey(), guardActionKey).subscribe({
        next: result => { if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return; this.retryingDockPrint = false; this.applyDriverPrintPackage(result, visitId, generation); },
        error: response => { if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return; this.retryingDockPrint = false; this.toast.error(response?.error?.message || 'Automatic Dock retry failed.', 'Retry not queued'); },
      });
      return;
    }
    const retryWindow = window.open('about:blank', '_blank');
    if (!retryWindow) {
      this.toast.warning('Allow pop-ups for Truck Log, then try the Dock Assignment retry again.', 'Slip window blocked');
      return;
    }
    this.retryingDockPrint = true;
    this.api.retryDockAssignmentPrint(
      printPackage.packageId,
      this.api.newIdempotencyKey(),
      guardActionKey,
    ).subscribe({
      next: (result) => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) {
          retryWindow.close();
          return;
        }
        this.retryingDockPrint = false;
        this.applyDriverPrintPackage(result, visitId, generation);
        if (visitId) retryWindow.location.href = this.api.slipUrl(visitId);
        else retryWindow.close();
        this.toast.success('Only the Dock Assignment Slip was opened again. Confirm its result after printing.', 'Dock retry started');
      },
      error: (response) => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) {
          retryWindow.close();
          return;
        }
        this.retryingDockPrint = false;
        retryWindow.close();
        this.toast.error(response?.error?.message || 'Could not retry the Dock Assignment Slip.', 'Dock retry failed');
      },
    });
  }

  /** Cancel/replace only jobs the server confirms were never leased to an agent. */
  recoverQueuedItem(item: DriverPrintItemRecord, action: 'CANCEL' | 'REPLACE') {
    const printPackage = this.lastPrintPackage;
    if (!printPackage || !item.recoverable || this.recoveringItemId || this.retryingDockPrint || this.retryingRxoPrint || this.reportingDockResult) return;
    const guardActionKey = this.guardActionKey();
    if (!guardActionKey) { this.toast.error('The original check-in action key is unavailable. Reopen the original browser session.', 'Print recovery unavailable'); return; }
    const reason = window.prompt(`Why ${action === 'CANCEL' ? 'cancel' : 'replace'} this queued ${this.printItemLabel(item)}? This is available only before an agent takes the job.`, 'Gate printer routing needs correction.');
    if (reason === null || !reason.trim()) return;
    let gate: 'EAST' | 'WEST' | undefined;
    if (action === 'REPLACE') {
      let savedGate = '';
      try { savedGate = window.localStorage.getItem('truckLogGuardGate') || ''; } catch { /* Gate can be entered below. */ }
      const selected = window.prompt('Send the replacement to which gate? Enter EAST or WEST. The current saved printer for that gate will be used.', savedGate);
      if (selected === null) return;
      const normalized = selected.trim().toUpperCase();
      if (normalized !== 'EAST' && normalized !== 'WEST') { this.toast.warning('Enter EAST or WEST to choose a replacement printer.', 'No replacement queued'); return; }
      gate = normalized;
    }
    const visitId = this.lastVisitId;
    const generation = this.packageContextGeneration;
    const payload = { itemType: item.itemType, action, reason: reason.trim(), ...(gate ? { gate } : {}) };
    const fingerprint = JSON.stringify([printPackage.packageId, payload]);
    const idempotencyKey = this.recoveryKeys.get(fingerprint) || this.api.newIdempotencyKey();
    this.recoveryKeys.set(fingerprint, idempotencyKey);
    this.recoveringItemId = item.id;
    this.api.recoverQueuedPrint(printPackage.packageId, payload, idempotencyKey, guardActionKey).subscribe({
      next: result => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return;
        this.recoveringItemId = '';
        this.recoveryKeys.delete(fingerprint);
        this.applyDriverPrintAction(result, visitId, generation);
        this.toast.success(action === 'CANCEL' ? 'The queued print was cancelled before an agent took it. Use a manual copy when needed.' : 'A separate replacement print was queued for the selected gate.', 'Print recovery saved');
      },
      error: response => {
        if (!this.isCurrentPrintContext(visitId, generation, printPackage.packageId)) return;
        this.recoveringItemId = '';
        this.toast.error(response?.error?.message || 'Recovery could not be confirmed. Refresh print status before trying again.', 'Print recovery not confirmed');
        this.refreshDriverPrintPackage(visitId, true, generation);
      },
    });
  }

  trackReplacement(item: DriverPrintItemRecord) {
    const current = this.lastPrintPackage;
    if (!current || !item.replacementPackageId || this.recoveringItemId || this.retryingDockPrint || this.retryingRxoPrint || this.reportingDockResult) return;
    const visitId = this.lastVisitId;
    const generation = this.packageContextGeneration;
    this.recoveringItemId = item.id;
    this.api.driverPrintPackageById(item.replacementPackageId).pipe(timeout(15000)).subscribe({
      next: result => {
        if (!this.isCurrentPrintContext(visitId, generation, current.packageId)) return;
        this.recoveringItemId = '';
        this.applyDriverPrintAction(result, visitId, generation);
      },
      error: response => {
        if (!this.isCurrentPrintContext(visitId, generation, current.packageId)) return;
        this.recoveringItemId = '';
        this.toast.error(response?.error?.message || 'Could not load replacement print status. Try again.', 'Replacement status unavailable');
      },
    });
  }

  refreshDriverPrintPackage(
    visitId = this.lastVisitId,
    silent = false,
    generation = this.packageContextGeneration,
  ) {
    if (!visitId || !this.isCurrentPrintContext(visitId, generation) || this.printPackageLoading) return;
    if (!silent) {
      // A manual refresh restarts the bounded status polling.
      this.printerNotResponding = false;
      this.printStatusUnreachable = false;
      this.pollErrors = 0;
      this.pollAttempts = 0;
      this.pollSince = 0;
    }
    this.printPackageLoading = true;
    // A recovery replacement is a distinct package; polling the visit would return its original.
    const packageId = this.lastPrintPackage?.packageId;
    const status = packageId ? this.api.driverPrintPackageById(packageId) : this.api.driverPrintPackage(visitId);
    status.pipe(timeout(15000)).subscribe({
      next: (result) => {
        if (!this.isCurrentPrintContext(visitId, generation)) return;
        this.printPackageLoading = false;
        this.pollErrors = 0;
        this.printStatusUnreachable = false;
        if (result) this.applyDriverPrintPackage(result, visitId, generation);
        else if (silent && this.packageDiscoveryDeadline > Date.now()) {
          this.packagePollTimer = window.setTimeout(
            () => this.refreshDriverPrintPackage(visitId, true, generation),
            2500,
          );
        } else if (!silent) {
          this.toast.warning('No Driver Print Package exists for this visit.', 'Print status unavailable');
        }
      },
      error: (response) => {
        if (!this.isCurrentPrintContext(visitId, generation)) return;
        this.printPackageLoading = false;
        this.pollErrors += 1;
        if (this.pollErrors >= PRINT_STATUS_UNREACHABLE_AFTER) this.printStatusUnreachable = true;
        if (silent && this.packageDiscoveryDeadline > Date.now()) {
          this.packagePollTimer = window.setTimeout(
            () => this.refreshDriverPrintPackage(visitId, true, generation),
            2500,
          );
        } else if (this.lastPrintPackage) {
          // A timeout/failure must release loading and keep bounded status checks recoverable.
          this.schedulePackageRefresh(visitId, generation);
        }
        if (!silent) this.toast.error(response?.error?.message || 'Could not refresh the Driver Print Package. Retrying automatically while printing is pending.', 'Print status unavailable');
      },
    });
  }

  /** Recovery can return a different package: ignore status GETs begun before it was acknowledged. */
  private applyDriverPrintAction(
    printPackage: DriverPrintPackageRecord,
    visitId: number | null,
    generation: number,
  ) {
    if (!this.isCurrentPrintContext(visitId, generation)) return;
    this.packageContextGeneration += 1;
    this.printPackageLoading = false;
    this.applyDriverPrintPackage(printPackage, visitId, this.packageContextGeneration);
  }

  private applyDriverPrintPackage(
    printPackage: DriverPrintPackageRecord,
    visitId = this.lastVisitId,
    generation = this.packageContextGeneration,
  ) {
    if (!this.isCurrentPrintContext(visitId, generation)) return;
    this.packageDiscoveryDeadline = 0;
    this.lastPrintPackage = printPackage;
    if (this.lastVisit) this.lastVisit = { ...this.lastVisit, driverPrintPackage: printPackage };
    this.schedulePackageRefresh(visitId, generation);
  }

  /**
   * Poll while an item is QUEUED/LEASED: 2.5 s, then backing off to 30 s.
   * Any status change restarts the clock; after PRINT_STATUS_POLL_LIMIT_MS
   * without a change, polling stops and the guard is told the printer is not
   * responding (Refresh Print Status checks again).
   */
  private schedulePackageRefresh(
    visitId = this.lastVisitId,
    generation = this.packageContextGeneration,
  ) {
    if (this.packagePollTimer) window.clearTimeout(this.packagePollTimer);
    const rxoStatus = this.rxoPrintItem?.status;
    const automaticPending = this.lastPrintPackage?.automaticDockAssignment && this.lastPrintPackage.items.some(item => item.status === 'QUEUED' || item.status === 'LEASED');
    if (!visitId || !this.isCurrentPrintContext(visitId, generation)
      || (!automaticPending && rxoStatus !== 'QUEUED' && rxoStatus !== 'LEASED')) {
      this.printerNotResponding = false;
      this.printStatusUnreachable = false;
      this.pollAttempts = 0;
      this.pollSince = 0;
      return;
    }
    const statusKey = (this.lastPrintPackage?.items ?? []).map((item) => `${item.itemType}:${item.status}`).join('|');
    if (statusKey !== this.pollStatusKey || !this.pollSince) {
      this.pollStatusKey = statusKey;
      this.pollSince = Date.now();
      this.pollAttempts = 0;
    }
    if (Date.now() - this.pollSince >= PRINT_STATUS_POLL_LIMIT_MS) {
      // Unchanged because the status could not be read is not the printer's fault.
      if (this.pollErrors > 0) this.printStatusUnreachable = true;
      else this.printerNotResponding = true;
      return;
    }
    const delay = Math.min(PRINT_STATUS_POLL_MAX_MS, PRINT_STATUS_POLL_START_MS * Math.pow(1.5, this.pollAttempts));
    this.pollAttempts += 1;
    this.packagePollTimer = window.setTimeout(
      () => this.refreshDriverPrintPackage(visitId, true, generation),
      delay,
    );
  }

  beginDriverPrintContext() {
    this.packageContextGeneration += 1;
    if (this.packagePollTimer) window.clearTimeout(this.packagePollTimer);
    this.packagePollTimer = undefined;
    this.packageDiscoveryDeadline = 0;
    this.printPackageLoading = false;
    this.reportingDockResult = false;
    this.retryingDockPrint = false;
    this.retryingRxoPrint = false;
    this.recoveringItemId = '';
    this.recoveryKeys.clear();
    this.printerNotResponding = false;
    this.printStatusUnreachable = false;
    this.pollErrors = 0;
    this.pollAttempts = 0;
    this.pollSince = 0;
    this.lastPrintPackage = null;
    this.lastRxoDocument = null;
    this.lastGuardActionKey = '';
  }

  private isCurrentPrintContext(
    visitId: number | null,
    generation: number,
    packageId?: string,
  ) {
    return Boolean(
      visitId
      && visitId === this.lastVisitId
      && generation === this.packageContextGeneration
      && (!packageId || packageId === this.lastPrintPackage?.packageId),
    );
  }

  private rememberGuardActionKey(visitId: number, guardActionKey: string) {
    this.lastGuardActionKey = guardActionKey;
    try {
      window.sessionStorage.setItem(`truckLog.guardAction.${visitId}`, guardActionKey);
    } catch {
      // The current in-memory key remains usable when session storage is disabled.
    }
  }

  private guardActionKey() {
    if (this.lastGuardActionKey) return this.lastGuardActionKey;
    if (!this.lastVisitId) return '';
    try {
      this.lastGuardActionKey = window.sessionStorage.getItem(
        `truckLog.guardAction.${this.lastVisitId}`,
      )?.trim() ?? '';
    } catch {
      this.lastGuardActionKey = '';
    }
    return this.lastGuardActionKey;
  }
}
