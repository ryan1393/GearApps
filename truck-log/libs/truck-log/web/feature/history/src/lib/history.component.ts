import { Component, DestroyRef, Injectable, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TruckLogApi } from '@truck-log/web/data-access';
import { DriverPrintItemRecord, TruckVisitRecord } from '@truck-log/shared/contracts';
import { recordStatusLabel, visitEventLabel } from '@truck-log/web/domain';
import { ToastService, TruckLogDialogDirective } from '@truck-log/web/ui';

/**
 * The Materials access token for RXO driver documents. Held in memory for this
 * browser tab only (never in sessionStorage/localStorage); cleared when the
 * server rejects it or the page is reloaded.
 */
@Injectable({ providedIn: 'root' })
export class MaterialsAccessTokenStore {
  private token = '';
  get(): string { return this.token; }
  set(value: string) { this.token = value.trim(); }
  clear() { this.token = ''; }
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, TruckLogDialogDirective],
  template: `
  <header class="dana-page-header">
    <div><h1>Records &amp; Paperwork</h1><p>Shows the 250 newest matches. Search by load, SAP Delivery Number, driver or date to find older visits.</p></div>
  </header>

  <section class="dana-panel">
    <div class="dana-panel-header"><h2>Find a Truck Visit</h2></div>
    <form class="dana-panel-body dana-filter-row tl-records-filters" (submit)="$event.preventDefault(); load()">
      <label class="tl-records-search">Search<input name="q" [(ngModel)]="q" placeholder="Load, visit, SAP Delivery Number, driver, carrier, trailer…"></label>
      <label>Status<select name="status" [(ngModel)]="status"><option value="ALL">All records</option><option value="ACTIVE">On site</option><option value="DOCK_ASSIGNED">At / Sent to Dock</option><option value="DOCK_COMPLETE">Dock Complete — Awaiting Guard</option><option value="GUARD_CHECKED_OUT">Checked out</option></select></label>
      <label>Check-in date<input name="date" [(ngModel)]="date" type="date"></label>
      <div class="dana-actions tl-filter-actions"><button type="submit" class="dana-btn dana-btn-primary" [disabled]="loading" [attr.aria-busy]="loading">{{loading ? 'Searching…' : 'Search'}}</button><button type="button" class="dana-btn" (click)="clearFilters()">Clear</button></div>
    </form>
  </section>

  <div class="tl-records-body" [class.has-detail]="!!selected">
  <section class="dana-panel" [attr.aria-busy]="loading">
    <div class="dana-panel-header">
      <div><h2>Visit Records</h2><p *ngIf="loading">Searching visit records…</p><p *ngIf="!loading && !searchError">{{pageStart}}–{{pageEnd}} of {{visits.length}} matching records</p><p class="dana-field-error" *ngIf="!loading && searchError">Search failed — retry when ready</p></div>
      <label class="dana-muted tl-inline-field" *ngIf="!loading && !searchError && visits.length">Rows per page <select class="dana-select tl-page-size" [(ngModel)]="pageSize" (ngModelChange)="page=1" aria-label="Records per page"><option [ngValue]="25">25</option><option [ngValue]="50">50</option><option [ngValue]="100">100</option></select></label>
    </div>
    <p class="dana-note tl-panel-note" *ngIf="!loading && !searchError && visits.length >= 250" role="note">Showing only the newest 250 matching visits. Narrow the search or date to find older ones.</p>
    <div class="dana-table-shell" role="region" aria-label="Visit records" tabindex="0"><table class="dana-table tl-wide-table"><thead><tr><th>Guard in</th><th>Load / Visit</th><th>Driver</th><th>Carrier</th><th>Trailer</th><th>Dock</th><th>Status</th><th>Paperwork</th><th><span class="dana-nowrap">Record</span></th></tr></thead><tbody>
      <tr *ngFor="let v of pageVisits"><td class="dana-nowrap">{{v.guardCheckInAt | date:'short'}}</td><td><b class="dana-nowrap">{{v.loadNumber || 'No load #'}}</b><span class="dana-cell-sub">{{v.visitReference}}</span><span class="dana-cell-sub" *ngIf="v.scannedDeliveryNumbers?.length">SAP {{v.scannedDeliveryNumbers?.join(', ')}}</span></td><td>{{v.driverName}}</td><td>{{v.carrierName || '—'}}</td><td class="dana-nowrap">{{v.trailerId || '—'}}</td><td><b class="dana-nowrap">{{v.dockCode || '—'}}</b></td><td><span class="dana-status-badge" [attr.data-tone]="v.status === 'DOCK_COMPLETE' ? 'warning' : v.status === 'GUARD_CHECKED_OUT' ? 'success' : 'info'">{{statusLabel(v.status)}}</span></td><td><span class="dana-count-badge" [attr.data-tone]="v.documentCount ? 'success' : null">{{v.documentCount || 0}} file{{v.documentCount === 1 ? '' : 's'}}</span></td><td><button class="dana-btn dana-btn-sm" type="button" (click)="openRecord(v)">Open</button></td></tr>
      <tr *ngIf="loading"><td colspan="9" class="dana-table-empty" role="status">Searching visit records…</td></tr>
      <tr *ngIf="!loading && searchError"><td colspan="9" class="dana-table-empty" role="alert">{{searchError}} <button type="button" class="dana-btn dana-btn-sm" (click)="load()">Retry Search</button></td></tr>
      <tr *ngIf="!loading && !searchError && !visits.length"><td colspan="9" class="dana-table-empty">No matching visits. Try another load number, SAP Delivery Number, date or status.</td></tr>
    </tbody></table></div>
    <nav class="dana-panel-body dana-actions tl-pagination" aria-label="Visit records pages" *ngIf="!loading && !searchError && pageCount > 1">
      <button class="dana-btn" type="button" (click)="setPage(page - 1)" [disabled]="page <= 1">Previous</button>
      <span class="dana-muted" aria-live="polite">Page {{page}} of {{pageCount}}</span>
      <button class="dana-btn" type="button" (click)="setPage(page + 1)" [disabled]="page >= pageCount">Next</button>
    </nav>
  </section>

  <section id="recordDetail" class="dana-panel" *ngIf="selected">
    <div class="dana-panel-header">
      <div><h2>{{selected.loadNumber || selected.visitReference}}</h2><p>{{selected.visitReference}}</p></div>
      <div class="dana-actions"><a class="dana-btn tl-guard-only" [href]="api.slipUrl(selected.id)" target="_blank">Print Slip</a><button class="dana-btn" type="button" (click)="closeRecord()">Close</button></div>
    </div>
    <div class="dana-panel-body tl-stack tl-scroll">
      <div class="dana-detail-grid">
        <div class="dana-detail"><span class="dana-detail-label">Status</span><span class="dana-detail-value">{{statusLabel(selected.status)}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Driver</span><span class="dana-detail-value">{{selected.driverName}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Driver phone</span><span class="dana-detail-value">{{selected.driverPhone || '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Carrier</span><span class="dana-detail-value">{{selected.carrierName || '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Dock</span><span class="dana-detail-value">{{selected.dockCode || '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Trailer</span><span class="dana-detail-value">{{selected.trailerId || '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Tractor</span><span class="dana-detail-value">{{selected.tractorId || '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Guard in</span><span class="dana-detail-value">{{selected.guardCheckInAt | date:'short'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Dock complete</span><span class="dana-detail-value">{{selected.dockCompletedAt ? (selected.dockCompletedAt | date:'short') : '—'}}</span></div>
        <div class="dana-detail"><span class="dana-detail-label">Final exit</span><span class="dana-detail-value">{{selected.guardCheckOutAt ? (selected.guardCheckOutAt | date:'short') : 'Still on site'}}</span></div>
        <div class="dana-detail" *ngIf="selected.rxoShipmentId"><span class="dana-detail-label">RXO shipment</span><span class="dana-detail-value">{{selected.rxoShipmentId}} · {{selected.rxoDirection}}</span><span class="dana-cell-sub">{{selected.rxoSiteKey}}</span></div>
      </div>
      <p class="dana-note" *ngIf="selected.scannedDeliveryNumbers?.length"><b>SAP Delivery {{selected.scannedDeliveryNumbers?.length === 1 ? 'Number' : 'Numbers'}}:</b> {{selected.scannedDeliveryNumbers?.join(', ')}} — recorded by scan or typing, separately from any PDF.</p>

      <section *ngIf="selected.driverPrintPackage as printPackage" class="tl-stack">
        <div class="dana-form-section"><h3>Driver Print Package</h3><div class="dana-actions"><span class="dana-status-badge">{{printPackage.status}}</span><button class="dana-btn dana-btn-sm tl-write tl-guard-only" type="button" *ngIf="printPackage.frozenRxoDocumentId" [disabled]="reprintingRxo" (click)="reprintRxoDocument()">{{reprintingRxo ? 'Queuing Reprint…' : 'Reprint RXO Document'}}</button></div></div>
        <p class="dana-muted" *ngIf="printPackage.frozenRxoDocumentId">Package {{printPackage.packageId}} · RXO document version {{printPackage.frozenRxoDocumentVersion || '—'}} · {{printPackage.frozenRxoDocumentFileName || ('Document #' + printPackage.frozenRxoDocumentId)}}</p>
        <div class="dana-table-shell"><table class="dana-table"><thead><tr><th>Item</th><th>Status</th><th>Printed</th></tr></thead><tbody>
          <tr *ngFor="let item of printPackage.items"><td><b>{{printItemLabel(item)}}</b><span class="dana-field-error" *ngIf="item.error">{{item.error}}</span></td><td>{{printItemStatusLabel(item)}}</td><td class="dana-nowrap">{{item.printedAt ? (item.printedAt | date:'short') : '—'}}</td></tr>
        </tbody></table></div>
      </section>

      <div class="tl-record-columns">
        <section class="tl-stack">
          <div class="dana-form-section"><h3>Paperwork <span class="dana-count-badge">{{selected.documents?.length || 0}}</span></h3>
            <label class="dana-btn dana-btn-primary dana-btn-sm tl-file-button tl-write" [attr.aria-disabled]="uploading">{{uploading ? 'Adding files…' : 'Add Paperwork'}}<input type="file" [disabled]="uploading" multiple accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.bmp" (change)="addPaperwork($event)"></label></div>
          <p class="dana-field-hint" *ngIf="uploading" role="status">Uploading paperwork…</p>
          <ul class="dana-file-list" *ngIf="selected.documents?.length">
            <li *ngFor="let d of selected.documents"><div><b>{{d.fileName}}</b>
              <span *ngIf="d.documentType==='PACKING_SLIP' && d.extractedDocumentId">Packing slip · SAP Delivery ID {{d.extractedDocumentId}}</span><span *ngIf="d.documentType==='PACKING_SLIP' && !d.extractedDocumentId">Packing slip · {{d.extractionMessage || 'SAP ID not detected'}}</span><span *ngIf="d.documentType==='RXO_DRIVER_DOCUMENT'">RXO driver document · version {{d.rxoDocumentVersion || '—'}}{{d.rxoIsActive ? ' · Active' : ' · Superseded'}}</span>
              <span>Scanned {{d.scannedAt | date:'short'}}{{d.scannedBy ? ' by ' + d.scannedBy : ''}}</span></div>
              <div class="dana-actions"><a class="dana-btn dana-btn-sm" *ngIf="d.documentType!=='RXO_DRIVER_DOCUMENT'" [href]="api.documentUrl(d.id)" target="_blank">Open</a><button class="dana-btn dana-btn-sm tl-guard-only" type="button" *ngIf="d.documentType==='RXO_DRIVER_DOCUMENT'" [disabled]="openingRxoDocumentId===d.id" (click)="openRxoDocument(d.id)">{{openingRxoDocumentId===d.id ? 'Opening…' : 'Open'}}</button><button class="dana-btn dana-btn-sm tl-write tl-guard-only" type="button" *ngIf="d.documentType==='RXO_DRIVER_DOCUMENT'" [disabled]="reprintingRxo" (click)="reprintRxoDocument(d.id)">Reprint</button></div></li>
          </ul>
          <div class="dana-empty-state" *ngIf="!selected.documents?.length">No paperwork attached.</div>
          <details class="dana-muted"><summary>Storage reference</summary><code>{{selected.documentFolderKey}}</code></details>
        </section>
        <section class="tl-stack">
          <div class="dana-form-section"><h3>Visit Timeline</h3></div>
          <div class="dana-table-shell"><table class="dana-table"><thead><tr><th>When</th><th>Event</th><th>By</th></tr></thead><tbody>
            <tr *ngFor="let event of selected.events"><td class="dana-nowrap">{{event.occurredAt | date:'short'}}</td><td><b>{{eventLabel(event)}}</b><span class="dana-cell-sub" *ngIf="event.notes">{{event.notes}}</span></td><td>{{event.actor || '—'}}</td></tr>
          </tbody></table></div>
        </section>
      </div>
    </div>
  </section>
  </div>

  <div class="dana-dialog-backdrop" *ngIf="tokenDialogOpen" (click)="cancelTokenDialog()">
    <form class="dana-dialog" tlDialog="materials-token-title" (tlDialogClose)="cancelTokenDialog()" (click)="$event.stopPropagation()" (ngSubmit)="submitTokenDialog()" autocomplete="off">
      <div class="dana-dialog-header"><h2 id="materials-token-title">Materials access token</h2>
      <p>RXO driver documents need an authorized Materials access token. It is kept in this browser tab's memory only and never saved.</p></div>
      <div class="dana-dialog-body"><label class="dana-field">Access token
        <input name="materialsToken" type="password" autocomplete="off" spellcheck="false" autofocus [(ngModel)]="tokenInput" required>
      </label></div>
      <div class="dana-dialog-actions">
        <button type="button" class="dana-btn" (click)="cancelTokenDialog()">Cancel</button>
        <button type="submit" class="dana-btn dana-btn-primary" [disabled]="!tokenInput.trim()">Continue</button>
      </div>
    </form>
  </div>`
})
export class HistoryComponent implements OnInit {
  q = '';
  status = 'ALL';
  date = '';
  visits: TruckVisitRecord[] = [];
  loading = false;
  searchError = '';
  page = 1;
  pageSize = 25;
  private searchRequest = 0;
  selected: TruckVisitRecord | null = null;

  get pageCount() { return Math.max(1, Math.ceil(this.visits.length / this.pageSize)); }
  get pageStart() { return this.visits.length ? (this.page - 1) * this.pageSize + 1 : 0; }
  get pageEnd() { return Math.min(this.page * this.pageSize, this.visits.length); }
  get pageVisits() { return this.visits.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); }
  setPage(next: number) { this.page = Math.max(1, Math.min(this.pageCount, Math.trunc(next))); }

  uploading = false;
  reprintingRxo = false;
  openingRxoDocumentId: number | null = null;
  private pendingReprintKey = '';
  private pendingReprintFingerprint = '';
  private openRequest = 0;
  /** In-app password dialog replacing window.prompt for the Materials token. */
  tokenDialogOpen = false;
  tokenInput = '';
  private afterToken: ((token: string) => void) | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly materialsToken = inject(MaterialsAccessTokenStore);

  constructor(public readonly api: TruckLogApi, private readonly route: ActivatedRoute, private readonly toast: ToastService) {}

  ngOnInit() {
    // The global search sets ?q=; an empty global search clears it.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.q = params.get('q') ?? '';
      // A search from the top bar looks through every record: leftover Status/Date filters from an
      // earlier visit to this page would otherwise hide the truck the guard is looking for.
      this.status = 'ALL';
      this.date = '';
      this.load();
    });
    // Repeating the same global search (same URL) re-runs it instead of doing nothing.
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((event) => {
      const url = this.router.parseUrl(event.urlAfterRedirects);
      if (!event.urlAfterRedirects.startsWith('/history')) return;
      const q = url.queryParamMap.get('q') ?? '';
      if (q === this.q && !this.loading) this.load();
    });
  }

  load() {
    const request = ++this.searchRequest;
    const q = this.q;
    const status = this.status;
    const date = this.date;
    this.loading = true;
    this.searchError = '';
    this.page = 1;
    this.visits = [];
    this.api.records(q, status, date).subscribe({
      next: (visits) => {
        if (request !== this.searchRequest) return;
        this.visits = visits;
        this.loading = false;
      },
      error: (e) => {
        if (request !== this.searchRequest) return;
        this.loading = false;
        this.searchError = e?.error?.message || 'Could not search visit records.';
        this.toast.error(this.searchError, 'Search failed');
      },
    });
  }

  clearFilters() { this.q = ''; this.status = 'ALL'; this.date = ''; this.load(); }

  openRecord(v: TruckVisitRecord) {
    if (this.selected?.id !== v.id) {
      this.pendingReprintKey = '';
      this.pendingReprintFingerprint = '';
    }
    // Only the most recently opened record may fill the detail panel.
    const request = ++this.openRequest;
    this.api.visit(v.id).subscribe({
      next: (detail) => {
        if (request !== this.openRequest) return;
        this.selected = detail;
        this.loadDriverPrintPackage(detail);
        setTimeout(() => document.getElementById('recordDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
      },
      error: (e) => { if (request === this.openRequest) this.toast.error(e?.error?.message || 'Could not open this visit record.', 'Could not open record'); },
    });
  }

  closeRecord() {
    ++this.openRequest;
    this.selected = null;
  }

  addPaperwork(event: Event) {
    if (!this.selected || this.uploading) return;
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.uploading = true;
    this.uploadFiles(this.selected.id, files, 0);
  }

  private uploadFiles(visitId: number, files: File[], index: number) {
    if (index >= files.length) {
      this.uploading = false;
      this.toast.success(`${files.length} paperwork ${files.length === 1 ? 'file' : 'files'} added.`, 'Paperwork added');
      this.api.visit(visitId).subscribe({
        next: (detail) => { if (this.selected?.id === visitId) this.selected = detail; this.load(); },
        error: () => this.load(),
      });
      return;
    }
    this.api.uploadDocument(visitId, files[index]).subscribe({
      next: () => this.uploadFiles(visitId, files, index + 1),
      error: (e) => {
        this.uploading = false;
        const saved = index ? ` ${index} earlier ${index === 1 ? 'file was' : 'files were'} saved; add only the rest again.` : '';
        this.toast.error(`Paperwork upload stopped at ${files[index].name}: ${e?.error?.message || 'upload error'}.${saved}`, 'Paperwork upload failed');
        // Show the files that did upload, so they are not added a second time.
        if (index) this.api.visit(visitId).subscribe({ next: (detail) => { if (this.selected?.id === visitId) this.selected = detail; }, error: () => undefined });
      },
    });
  }

  private loadDriverPrintPackage(visit: TruckVisitRecord) {
    this.api.driverPrintPackage(visit.id).subscribe({
      next: (printPackage) => {
        if (this.selected?.id === visit.id) {
          this.selected = { ...this.selected, driverPrintPackage: printPackage };
        }
      },
      error: () => {
        // Visits without an RXO Driver Print Package retain the existing record view.
      },
    });
  }

  reprintRxoDocument(selectedDocumentId?: number) {
    const visit = this.selected;
    const documentId = selectedDocumentId ?? visit?.driverPrintPackage?.frozenRxoDocumentId;
    if (!visit || !documentId || this.reprintingRxo) return;
    this.withMaterialsToken((accessToken) => this.queueReprint(visit, documentId, accessToken));
  }

  private queueReprint(visit: TruckVisitRecord, documentId: number, accessToken: string) {
    if (this.reprintingRxo) return;
    const requestFingerprint = `${visit.id}:${documentId}`;
    if (!this.pendingReprintKey || this.pendingReprintFingerprint !== requestFingerprint) {
      this.pendingReprintKey = this.api.newIdempotencyKey();
      this.pendingReprintFingerprint = requestFingerprint;
    }
    this.reprintingRxo = true;
    this.api.reprintRxoDriverDocument(
      visit.id,
      documentId,
      accessToken,
      this.pendingReprintKey,
    ).subscribe({
      next: (printPackage) => {
        this.reprintingRxo = false;
        this.pendingReprintKey = '';
        this.pendingReprintFingerprint = '';
        if (this.selected?.id === visit.id) {
          this.selected = { ...this.selected, driverPrintPackage: printPackage };
        }
        this.toast.success('The exact RXO document version was queued as a new audited reprint.', 'RXO reprint queued');
        this.api.visit(visit.id).subscribe({
          next: (detail) => {
            if (this.selected?.id === visit.id) {
              this.selected = { ...detail, driverPrintPackage: printPackage };
            }
          },
        });
        this.load();
      },
      error: (response) => {
        this.reprintingRxo = false;
        if (response?.status === 401 || response?.status === 403) this.materialsToken.clear();
        this.toast.error(response?.error?.message || 'Could not queue the RXO document reprint.', 'Reprint failed');
      },
    });
  }

  openRxoDocument(documentId: number) {
    if (this.openingRxoDocumentId !== null) return;
    // Opened from the click (or the dialog's Continue click) so pop-up blockers allow it.
    this.withMaterialsToken((accessToken) => this.openRxoDocumentWithToken(documentId, accessToken));
  }

  private openRxoDocumentWithToken(documentId: number, accessToken: string) {
    if (this.openingRxoDocumentId !== null) return;
    const preview = window.open('about:blank', '_blank');
    if (!preview) {
      this.toast.warning('Allow pop-ups for Truck Log, then try Open again.', 'Document window blocked');
      return;
    }
    this.openingRxoDocumentId = documentId;
    this.api.downloadRxoDriverDocument(documentId, accessToken).subscribe({
      next: (pdf) => {
        this.openingRxoDocumentId = null;
        const objectUrl = URL.createObjectURL(pdf);
        preview.location.href = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      },
      error: (response) => {
        this.openingRxoDocumentId = null;
        preview.close();
        if (response?.status === 401 || response?.status === 403) this.materialsToken.clear();
        this.toast.error(response?.error?.message || 'Could not open the RXO driver document.', 'Document unavailable');
      },
    });
  }

  printItemLabel(item: DriverPrintItemRecord) {
    return item.itemType === 'DOCK_ASSIGNMENT' ? 'Dock Assignment Slip' : 'RXO Driver Document';
  }

  printItemStatusLabel(item: DriverPrintItemRecord) {
    const labels: Record<DriverPrintItemRecord['status'], string> = {
      PENDING_CONFIRMATION: 'Awaiting guard confirmation',
      QUEUED: 'Queued',
      LEASED: 'Printing',
      PRINTED: 'Printed',
      FAILED: 'Failed',
    };
    return labels[item.status];
  }

  /** Run an action that needs the Materials token, asking for it in an in-app dialog when not yet known. */
  private withMaterialsToken(action: (token: string) => void) {
    const token = this.materialsToken.get();
    if (token) { action(token); return; }
    this.afterToken = action;
    this.tokenInput = '';
    this.tokenDialogOpen = true;
  }

  submitTokenDialog() {
    const token = this.tokenInput.trim();
    if (!token) return;
    this.materialsToken.set(token);
    const action = this.afterToken;
    this.tokenInput = '';
    this.afterToken = null;
    this.tokenDialogOpen = false;
    action?.(token);
  }

  cancelTokenDialog() {
    this.tokenInput = '';
    this.afterToken = null;
    this.tokenDialogOpen = false;
  }

  readonly statusLabel = recordStatusLabel;
  readonly eventLabel = visitEventLabel;
}
