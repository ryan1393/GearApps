import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TruckLogApi } from '@truck-log/web/data-access';
import {
  DockAgingSettingsRecord,
  DockDeliveryScanReceipt,
  PackingSlipExtractionStatuses,
  TruckVisitRecord,
  VisitDocumentRecord,
} from '@truck-log/shared/contracts';
import { elapsedSince } from '@truck-log/web/domain';
import { DEFAULT_DOCK_AGING_SETTINGS, dockAgeClass, dockAgeMinutes, dockAgeTone } from '@truck-log/web/domain';
import { DockScanComponent } from './dock-scan/dock-scan.component';
import { ToastService, TruckLogDialogDirective, jumpToSection, PlantDatePipe } from '@truck-log/web/ui';

type DockDirectionFilter = 'ALL' | 'INBOUND' | 'OUTBOUND';
type DockUrgencyFilter = 'ALL' | 'AGING' | 'OVERDUE';

// Search only existing read-only visit fields. Never request, mutate, or attach PDFs.
export function dockBoardSearchText(visit: TruckVisitRecord): string {
  return [
    visit.loadNumber,
    visit.dockCode,
    visit.trailerId,
    visit.tractorId,
    visit.driverName,
    visit.carrierName,
    visit.visitReference,
    visit.visitNumber,
    String(visit.id),
    ...(visit.scannedDeliveryNumbers ?? []),
  ].filter((value): value is string => typeof value === 'string' && !!value)
    .join(' ').toLocaleLowerCase();
}

export function filterDockBoard(
  visits: readonly TruckVisitRecord[],
  search: string,
  direction: DockDirectionFilter,
  urgency: DockUrgencyFilter,
  aging: DockAgingSettingsRecord,
  now = Date.now(),
): TruckVisitRecord[] {
  const term = search.trim().toLocaleLowerCase();
  return visits.filter((visit) => {
    if (direction !== 'ALL' && visit.direction !== direction) return false;
    const age = dockAgeClass(visit, aging, now);
    if (urgency === 'OVERDUE' && age !== 'dock-age-critical') return false;
    if (urgency === 'AGING' && age !== 'dock-age-warning' && age !== 'dock-age-critical') return false;
    return !term || dockBoardSearchText(visit).includes(term);
  });
}

export function dockBoardCounts(
  visits: readonly TruckVisitRecord[],
  aging: DockAgingSettingsRecord,
  now = Date.now(),
): { aging: number; overdue: number } {
  let agingCount = 0;
  let overdue = 0;
  for (const visit of visits) {
    const age = dockAgeClass(visit, aging, now);
    if (age === 'dock-age-warning') agingCount += 1;
    if (age === 'dock-age-critical') overdue += 1;
  }
  return { aging: agingCount, overdue };
}

@Component({
  standalone: true,
  imports: [CommonModule, DockScanComponent, TruckLogDialogDirective, PlantDatePipe],
  template: `
  <header class="dana-page-header">
    <div><h1>Dock Board</h1><p><span *ngIf="lastUpdated">Updated {{lastUpdated | plantDate:'shortTime'}} · refreshes automatically · </span>Packing slips are optional; the guard prints them at Final Checkout.</p></div>
    <div class="dana-actions"><button class="dana-btn" type="button" (click)="load()">Refresh</button></div>
  </header>

  <section class="dana-panel" aria-label="Find and filter dock trucks">
    <div class="dana-panel-body dana-filter-row tl-dock-filters">
      <label class="tl-dock-search">Find a truck<input id="dock-board-search" type="search" autocomplete="off" [value]="searchTerm" (input)="onSearchInput($event)" placeholder="Load, dock, driver, trailer, SAP number…" aria-label="Find a truck by load, dock, driver, carrier, trailer, tractor, visit or SAP delivery number"></label>
      <label>Direction<select id="dock-board-direction" [value]="directionFilter" (change)="onDirectionChange($event)"><option value="ALL">All directions</option><option value="INBOUND">Inbound</option><option value="OUTBOUND">Outbound</option></select></label>
      <label>Dock wait<select id="dock-board-urgency" [value]="urgencyFilter" (change)="onUrgencyChange($event)"><option value="ALL">All wait times</option><option value="AGING">Aging + overdue</option><option value="OVERDUE">Overdue only</option></select></label>
      <button class="dana-btn dana-btn-ghost" type="button" [disabled]="!hasActiveFilters" (click)="clearFilters()">Clear filters</button>
      <div class="tl-dock-counts" role="status" aria-live="polite" aria-atomic="true">
        <button type="button" class="dana-count-badge tl-count-jump" [attr.aria-pressed]="!hasActiveFilters" title="Show every dock" (click)="showUrgency('ALL')">{{filteredVisits.length}} of {{totalCount}} shown</button>
        <button type="button" class="dana-count-badge tl-count-jump" [attr.data-tone]="agingCount ? 'warning' : null" [attr.aria-pressed]="urgencyFilter === 'AGING'" title="Show aging and overdue docks" (click)="showUrgency('AGING')">{{agingCount}} aging</button>
        <button type="button" class="dana-count-badge tl-count-jump" [attr.data-tone]="overdueCount ? 'danger' : null" [attr.aria-pressed]="urgencyFilter === 'OVERDUE'" title="Show overdue docks only" (click)="showUrgency('OVERDUE')">{{overdueCount}} overdue</button>
      </div>
    </div>
  </section>
  <p *ngIf="refreshError" class="dana-alert dana-alert-warning tl-notice" role="alert">Dock Board refresh failed. Showing last confirmed data<span *ngIf="lastUpdated"> from {{lastUpdated | plantDate:'shortTime'}}</span>. Select Refresh to retry.</p>

  <div class="tl-dock-grid" id="dock-board-grid" role="region" aria-label="Assigned docks" tabindex="0">
    <article class="dana-card" *ngFor="let visit of filteredVisits; trackBy: trackDockVisit" [attr.data-tone]="ageTone(visit)">
      <header class="dana-card-header">
        <div><span class="dana-card-eyebrow">Dock</span><strong class="dana-card-title">{{visit.dockCode || '—'}}</strong></div>
        <div class="dana-actions">
          <span class="dana-status-badge is-plain" data-tone="neutral">{{visit.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}}</span>
          <span class="dana-status-badge" [attr.data-tone]="ageTone(visit) || 'success'">{{dockAgeLabel(visit)}}</span>
        </div>
      </header>
      <div><strong class="dana-card-subtitle">{{visit.loadNumber || 'No load #'}}</strong><span class="dana-cell-sub">{{visit.visitReference}}</span></div>
      <div class="dana-detail-grid tl-dock-facts">
        <div class="dana-detail"><span class="dana-detail-label">Driver</span><span class="dana-detail-value">{{visit.driverName}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Carrier</span><span class="dana-detail-value">{{visit.carrierName || '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Trailer</span><span class="dana-detail-value">{{visit.trailerId || '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Checked in</span><span class="dana-detail-value">{{visit.guardCheckInAt | plantDate:'smartTime'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">On site</span><span class="dana-detail-value">{{elapsed(visit.guardCheckInAt)}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">At dock</span><span class="dana-detail-value">{{visit.dockAssignedAt ? elapsed(visit.dockAssignedAt) : '—'}}</span></div>
      </div>
      <p class="dana-note" *ngIf="visit.scannedDeliveryNumbers?.length"><b>SAP Delivery Number{{visit.scannedDeliveryNumbers!.length > 1 ? 's' : ''}}:</b> {{visit.scannedDeliveryNumbers?.join(', ')}}</p>

      <section class="dana-card-section tl-stack" [attr.data-tone]="packingSlipReady(visit) ? 'success' : (packingSlip(visit) ? 'warning' : null)">
        <div class="dana-card-header">
          <div><span class="dana-card-eyebrow">Packing slip</span><strong>{{packingSlipReady(visit) ? 'SAP ID detected' : (packingSlip(visit) ? (packingSlipAvailable(visit) ? 'Attached — SAP ID needs review' : 'PDF unavailable') : 'Not attached (optional)')}}</strong></div>
          <span class="dana-status-badge is-plain" [attr.data-tone]="packingSlipReady(visit) ? 'success' : (packingSlipAvailable(visit) ? 'warning' : 'neutral')">{{packingSlipReady(visit) ? 'Ready' : (packingSlipAvailable(visit) ? 'Attached' : 'Missing')}}</span>
        </div>
        <input #packingSlipInput type="file" hidden accept=".pdf,application/pdf" (change)="uploadPackingSlip(visit, $event)">
        <ng-container *ngIf="packingSlip(visit) as slip; else noPackingSlip">
          <div class="tl-stack">
            <span *ngIf="packingSlipReady(visit)">SAP Document / Delivery ID <strong>{{slip.extractedDocumentId}}</strong></span>
            <span class="dana-field-error" *ngIf="!packingSlipReady(visit)">{{slip.extractionMessage || 'SAP Document/Delivery ID is still in review.'}}</span>
            <small class="dana-muted">{{slip.originalFileName || slip.fileName}} · {{slip.scannedAt | plantDate:'short'}}{{slip.scannedBy ? ' · ' + slip.scannedBy : ''}}</small>
          </div>
          <div class="dana-actions">
            <a *ngIf="packingSlipAvailable(visit)" class="dana-btn dana-btn-sm" [href]="packingSlipUrl(slip)" target="_blank" rel="noopener">View PDF</a>
            <button class="dana-btn dana-btn-sm tl-write" type="button" [disabled]="uploadingVisitId !== null || busy" (click)="packingSlipInput.click()">{{uploadingVisitId===visit.id ? 'Reading PDF…' : 'Replace PDF'}}</button>
            <button class="dana-btn dana-btn-sm tl-write" type="button" [disabled]="busy || uploadingVisitId !== null" (click)="openScanner(visit)">Scan Delivery Number</button>
          </div>
        </ng-container>
        <ng-template #noPackingSlip>
          <div class="dana-actions tl-write">
            <button type="button" class="dana-btn dana-btn-primary" [disabled]="busy || uploadingVisitId !== null" (click)="openScanner(visit)">Scan Document</button>
            <button type="button" class="dana-btn" [disabled]="busy || uploadingVisitId !== null" (click)="openScanner(visit, true)">Find PDF</button>
            <button class="dana-btn" type="button" [disabled]="uploadingVisitId !== null || busy" (click)="packingSlipInput.click()">{{uploadingVisitId===visit.id ? 'Reading PDF…' : 'Upload PDF'}}</button>
          </div>
        </ng-template>
      </section>

      <button class="dana-btn dana-btn-success dana-btn-block tl-write" type="button" [disabled]="busy || uploadingVisitId===visit.id" (click)="askComplete(visit)">Dock Complete — Send to Guard</button>
    </article>
    <div class="dana-empty-state tl-dock-grid-empty" *ngIf="!filteredVisits.length && visits.length"><b>No trucks match the current filters.</b> Change the search or filters to see other docks. <button class="dana-btn dana-btn-sm" type="button" (click)="clearFilters()">Clear filters</button></div>
    <div class="dana-empty-state tl-dock-grid-empty" *ngIf="!visits.length && !lastUpdated && !refreshError">Loading assigned docks…</div>
    <div class="dana-empty-state tl-dock-grid-empty" *ngIf="!visits.length && lastUpdated && !refreshError"><b>No trucks are waiting for dock completion.</b> The board refreshes automatically.</div>
    <div class="dana-empty-state tl-dock-grid-empty" *ngIf="!visits.length && refreshError"><b>Unable to confirm Dock Board contents.</b> Retry Refresh; an unavailable feed does not mean every dock is empty.</div>
  </div>

  <app-dock-packing-scan *ngIf="scanTarget" [visit]="scanTarget" [closeAfterSave]="scanCloseAfterSave" (saved)="deliveryNumberSaved($event)" (closed)="closeScanner()" (attached)="scannedPackingSlipAttached($event)"></app-dock-packing-scan>
  <div class="dana-dialog-backdrop" *ngIf="completeTarget" (click)="cancelComplete()"><div class="dana-dialog" tlDialog="dock-complete-title" [tlDialogEscape]="!busy" (tlDialogClose)="cancelComplete()" (click)="$event.stopPropagation()">
    <div class="dana-dialog-header"><h2 id="dock-complete-title">Mark Dock Complete?</h2><p>The driver goes to the guard for Final Checkout. Any attached packing slip stays in Truck Log; a missing PDF doesn't block completion.</p></div>
    <div class="dana-dialog-body"><div class="dana-note"><b>Dock {{completeTarget.dockCode}} — {{completeTarget.loadNumber || completeTarget.visitReference}}</b><span class="dana-cell-sub">{{completeTarget.driverName}} · Trailer {{completeTarget.trailerId}}</span><span class="dana-cell-sub" *ngIf="packingSlipReady(completeTarget)">SAP Document / Delivery ID {{packingSlip(completeTarget)?.extractedDocumentId}}</span><span class="dana-cell-sub" *ngIf="packingSlip(completeTarget) && !packingSlipReady(completeTarget)">Packing slip attached — SAP ID pending review</span><span class="dana-cell-sub" *ngIf="!packingSlip(completeTarget)">No packing slip attached</span></div></div>
    <div class="dana-dialog-actions"><button class="dana-btn" type="button" (click)="cancelComplete()">Cancel</button><button class="dana-btn dana-btn-success" type="button" [disabled]="busy" (click)="confirmComplete()">{{busy ? 'Saving…' : 'Confirm Dock Complete'}}</button></div>
  </div></div>`
})
export class DockBoardComponent implements OnInit, OnDestroy {
  visits: TruckVisitRecord[] = [];
  filteredVisits: TruckVisitRecord[] = [];
  searchTerm = '';
  directionFilter: DockDirectionFilter = 'ALL';
  urgencyFilter: DockUrgencyFilter = 'ALL';
  agingCount = 0;
  overdueCount = 0;
  refreshError = false;
  lastUpdated?: Date;
  completeTarget: TruckVisitRecord | null = null;
  busy = false;
  scanTarget: TruckVisitRecord | null = null;
  scanCloseAfterSave = true;
  private scanSavedDuringDialog = false;
  uploadingVisitId: number | null = null;
  aging: DockAgingSettingsRecord = { ...DEFAULT_DOCK_AGING_SETTINGS };
  private timer?: number;
  private boardRequestPending = false;
  private agingRequestPending = false;

  constructor(public readonly api: TruckLogApi, private readonly toast: ToastService) {}

  ngOnInit() { this.load(); this.timer = window.setInterval(() => this.load(false), 10000); }
  ngOnDestroy() { this.packingBoardDestroyed = true; ++this.packingBoardRequest; if (this.timer) window.clearInterval(this.timer); }

  get totalCount(): number { return this.visits.length; }
  get hasActiveFilters(): boolean { return !!this.searchTerm.trim() || this.directionFilter !== 'ALL' || this.urgencyFilter !== 'ALL'; }
  onSearchInput(event: Event): void {
    this.searchTerm = (event.target as HTMLInputElement).value;
    this.updateFilteredVisits();
  }
  onDirectionChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.directionFilter = value === 'INBOUND' || value === 'OUTBOUND' ? value : 'ALL';
    this.updateFilteredVisits();
  }
  onUrgencyChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.urgencyFilter = value === 'AGING' || value === 'OVERDUE' ? value : 'ALL';
    this.updateFilteredVisits();
  }
  /** A count badge was clicked: filter the board to that wait level ('ALL' clears every filter) and jump to the cards. */
  showUrgency(level: DockUrgencyFilter): void {
    if (level === 'ALL') this.clearFilters();
    else { this.urgencyFilter = level; this.updateFilteredVisits(); }
    jumpToSection('dock-board-grid');
  }
  clearFilters(): void {
    this.searchTerm = '';
    this.directionFilter = 'ALL';
    this.urgencyFilter = 'ALL';
    this.updateFilteredVisits();
  }
  private updateFilteredVisits(): void {
    const now = Date.now();
    this.filteredVisits = filterDockBoard(this.visits, this.searchTerm, this.directionFilter, this.urgencyFilter, this.aging, now);
    const counts = dockBoardCounts(this.visits, this.aging, now);
    this.agingCount = counts.aging;
    this.overdueCount = counts.overdue;
  }

  load(showError = true) {
    if (this.packingBoardDestroyed || this.uploadingVisitId !== null || this.scanTarget) return;
    // A background tick never starts a second request while one is pending: on slow dock Wi-Fi each
    // new tick would otherwise supersede the last, every answer would be discarded, and the board
    // would freeze without ever showing its refresh warning. A manual Refresh still supersedes.
    if (!showError && this.boardRequestPending) return;
    const request = ++this.packingBoardRequest;
    this.boardRequestPending = true;
    // Recompute urgency from the local clock even if an HTTP refresh is delayed or fails.
    this.updateFilteredVisits();
    this.loadAgingSettings();
    this.api.dockBoard(Date.now().toString(36) + '-' + request).subscribe({
      next: (visits) => {
        if (request === this.packingBoardRequest) this.boardRequestPending = false;
        if (this.packingBoardDestroyed || request !== this.packingBoardRequest || this.uploadingVisitId !== null || this.scanTarget) return;
        this.visits = [...visits].sort((left, right) => {
          const leftAge = dockAgeMinutes(left) ?? -1;
          const rightAge = dockAgeMinutes(right) ?? -1;
          return rightAge - leftAge || String(left.dockCode || '').localeCompare(String(right.dockCode || ''));
        });
        this.lastUpdated = new Date();
        this.refreshError = false;
        this.updateFilteredVisits();
      },
      error: () => { if (request === this.packingBoardRequest) this.boardRequestPending = false; if (this.packingBoardDestroyed || request !== this.packingBoardRequest || this.uploadingVisitId !== null || this.scanTarget) return; this.refreshError = true; if (showError) this.toast.error('Could not refresh the dock board. Check System status.', 'Dock Board refresh failed'); },
    });
  }

  private loadAgingSettings() {
    if (this.agingRequestPending) return;
    this.agingRequestPending = true;
    this.api.dockAgingSettings().subscribe({
      next: (aging) => { this.agingRequestPending = false; if (this.packingBoardDestroyed) return; this.aging = aging; this.updateFilteredVisits(); },
      error: () => { this.agingRequestPending = false; },
    });
  }

  ageClass(visit: TruckVisitRecord) { return dockAgeClass(visit, this.aging); }
  ageTone(visit: TruckVisitRecord) { return dockAgeTone(visit, this.aging); }
  dockAgeLabel(visit: TruckVisitRecord) {
    const state = this.ageClass(visit);
    if (state === 'dock-age-critical') return 'OVERDUE';
    if (state === 'dock-age-warning') return 'AGING';
    return 'ON TIME';
  }
  readonly elapsed = elapsedSince;

  packingSlip(visit: TruckVisitRecord): VisitDocumentRecord | null {
    return visit.documents?.find((document) => document.documentType === 'PACKING_SLIP') ?? null;
  }

  packingSlipAvailable(visit: TruckVisitRecord): boolean {
    const slip = this.packingSlip(visit);
    return Boolean(slip && slip.fileAvailable !== false);
  }

  openScanner(visit: TruckVisitRecord, reviewPdf = false): void {
    if (this.busy || this.uploadingVisitId !== null || this.completeTarget) return;
    ++this.packingBoardRequest;
    this.scanCloseAfterSave = !reviewPdf;
    this.scanSavedDuringDialog = false;
    this.scanTarget = visit;
  }
  closeScanner(): void {
    const confirmedSave = this.scanSavedDuringDialog;
    this.scanTarget = null;
    this.scanSavedDuringDialog = false;
    // Keep the committed receipt visible; the normal fresh-key poll resumes.
    if (!confirmedSave) this.load(false);
  }
  deliveryNumberSaved(receipt: DockDeliveryScanReceipt): void {
    const visit = this.scanTarget;
    if (this.packingBoardDestroyed || !this.scanCloseAfterSave || !visit || !receipt || receipt.visitId !== visit.id ||
        typeof receipt.deliveryNumber !== 'string' || !/^[0-9]{8}$/.test(receipt.deliveryNumber) ||
        !Number.isSafeInteger(receipt.eventId) || receipt.eventId <= 0 || typeof receipt.alreadySaved !== 'boolean' ||
        typeof receipt.savedAt !== 'string' || !Number.isFinite(Date.parse(receipt.savedAt))) return;
    ++this.packingBoardRequest;
    visit.scannedDeliveryNumbers = [...new Set([...(visit.scannedDeliveryNumbers || []), receipt.deliveryNumber])];
    this.visits = this.visits.map(target => target.id === visit.id ? {
      ...target, scannedDeliveryNumbers: [...new Set([...(target.scannedDeliveryNumbers || []), receipt.deliveryNumber])],
    } : target);
    this.scanSavedDuringDialog = true;
    this.lastUpdated = new Date();
    this.updateFilteredVisits();
    this.toast.success(`Delivery ${receipt.deliveryNumber} saved to ${visit.loadNumber || visit.visitReference}.`, 'Delivery Number saved');
  }
  scannedPackingSlipAttached(document: VisitDocumentRecord): void {
    const visit = this.scanTarget;
    if (!visit || document.truckVisitId !== visit.id || !this.packingSlipReceiptMatches(visit.id, document.fileSizeBytes || 0, document)) return;
    ++this.packingBoardRequest;
    this.applyPackingSlipReceipt(visit, document);
    this.scanTarget = null;
    this.toast.success(`Scanned Delivery ${document.extractedDocumentId} attached to ${visit.loadNumber || visit.visitReference}.`, 'Packing slip attached');
  }

  packingSlipReady(visit: TruckVisitRecord) {
    const slip = this.packingSlip(visit);
    return Boolean(
      slip && this.packingSlipAvailable(visit) &&
      slip.extractionStatus === PackingSlipExtractionStatuses.DETECTED &&
      slip.extractedDocumentId,
    );
  }

  uploadPackingSlip(visit: TruckVisitRecord, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.packingBoardDestroyed || this.uploadingVisitId !== null || this.busy) return;
    const mime = file.type.toLowerCase();
    if (!file.name.toLowerCase().endsWith('.pdf') || (mime && mime !== 'application/pdf' && mime !== 'application/octet-stream')) {
      this.toast.warning('Select one PDF packing slip. Image files and other paperwork belong in Records & Paperwork.', 'PDF required');
      return;
    }
    ++this.packingBoardRequest;
    this.uploadingVisitId = visit.id;
    this.api.uploadPackingSlip(visit.id, file).subscribe({
      next: (document) => {
        if (this.packingBoardDestroyed) return;
        ++this.packingBoardRequest;
        this.uploadingVisitId = null;
        if (!this.packingSlipReceiptMatches(visit.id, file.size, document)) {
          this.toast.error('The upload response did not confirm the selected visit and PDF. Refresh this visit and inspect its current PDF before retrying.', 'Packing slip save unconfirmed');
          this.load(false);
          return;
        }
        this.applyPackingSlipReceipt(visit, document);
        if (document.extractionStatus === PackingSlipExtractionStatuses.DETECTED && document.extractedDocumentId) {
          this.toast.success(`Saved ${document.originalFileName || file.name} to ${visit.visitReference}. SAP Document/Delivery ID ${document.extractedDocumentId}.`, 'Packing slip saved');
        } else {
          this.toast.warning(`Saved ${document.originalFileName || file.name} to ${visit.visitReference}. ${document.extractionMessage || 'SAP Document/Delivery ID needs review.'}`, 'PDF saved - SAP ID needs review');
        }
        // The committed receipt is authoritative. Do not replace it with an older polling response.
        // The normal fresh-key background poll resumes on its existing interval.
      },
      error: (error) => {
        if (this.packingBoardDestroyed) return;
        ++this.packingBoardRequest;
        this.uploadingVisitId = null;
        this.toast.error(error?.error?.message || 'Could not upload the packing-slip PDF.', 'Packing slip upload failed');
      },
    });
  }

  askComplete(visit: TruckVisitRecord) {
    if (this.busy || this.uploadingVisitId !== null || this.scanTarget) return;
    this.completeTarget = visit;
  }
  cancelComplete() { if (!this.busy) this.completeTarget = null; }
  confirmComplete() {
    if (!this.completeTarget || this.busy) return;
    const visit = this.completeTarget;
    this.busy = true;
    this.api.markDockComplete(visit.id).subscribe({
      next: () => {
        this.busy = false;
        this.completeTarget = null;
        this.toast.success(`${visit.driverName} is dock complete. Send the driver back to the guard shack.`, 'Dock complete');
        this.load();
      },
      error: (error) => {
        this.busy = false;
        this.toast.error(error?.error?.message || 'Could not complete the dock step.', 'Dock completion failed');
      },
    });
  }

  // stable inputs, ordered refresh responses, and a revision-specific PDF link.
  private packingBoardRequest = 0;
  private packingBoardDestroyed = false;

  trackDockVisit(_index: number, visit: TruckVisitRecord): number { return visit.id; }

  packingSlipUrl(document: VisitDocumentRecord): string {
    const revision = String(document.sha256 || '') + ':' + String(document.scannedAt || '');
    return this.api.documentUrl(document.id) + '?revision=' + encodeURIComponent(revision);
  }

  private packingSlipReceiptMatches(visitId: number, size: number, document: VisitDocumentRecord): boolean {
    return Boolean(document && Number.isSafeInteger(document.id) && document.id > 0 &&
      document.truckVisitId === visitId && document.documentType === 'PACKING_SLIP' &&
      document.fileSizeBytes === size && typeof document.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(document.sha256) && typeof document.scannedAt === 'string' &&
      Number.isFinite(Date.parse(document.scannedAt)));
  }

  private applyPackingSlipReceipt(visit: TruckVisitRecord, document: VisitDocumentRecord): void {
    const update = (target: TruckVisitRecord): TruckVisitRecord => ({
      ...target,
      documents: [document, ...(target.documents || []).filter(item => item.documentType !== 'PACKING_SLIP')],
    });
    visit.documents = update(visit).documents;
    this.visits = this.visits.map(target => target.id === visit.id ? update(target) : target);
    if (this.completeTarget?.id === visit.id) this.completeTarget = update(this.completeTarget);
    this.lastUpdated = new Date();
    this.updateFilteredVisits();
  }
}
