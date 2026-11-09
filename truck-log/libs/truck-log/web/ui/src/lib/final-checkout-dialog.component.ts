import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TruckVisitRecord, VisitDocumentRecord } from '@truck-log/shared/contracts';
import { ObjectUrlSlot, TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from './toast.service';
import { TruckLogDialogDirective } from './dialog.directive';

/**
 * Final guard checkout, shared by the Guard Dashboard and Active Trucks.
 * Render it with *ngIf while a visit is selected; it reloads the full visit,
 * gates "Finish" on opening the available packing slip (server print proof),
 * and emits `completed` after a confirmed checkout or `closed` on Return.
 */
@Component({
  selector: 'tl-final-checkout-dialog',
  standalone: true,
  imports: [CommonModule, TruckLogDialogDirective],
  template: `
  <div class="dana-dialog-backdrop" (click)="cancel()">
    <div class="dana-dialog tl-checkout-dialog" [tlDialog]="titleId" [tlDialogEscape]="!busy" (tlDialogClose)="cancel()" (click)="$event.stopPropagation()">
      <div class="dana-dialog-header">
        <h2 [id]="titleId">Final Guard Checkout</h2>
        <p>Print the attached packing slip when there is one. A missing PDF doesn't block checkout.</p>
      </div>
      <div class="dana-dialog-body tl-stack">
        <div class="dana-detail-grid">
          <div class="dana-detail"><span class="dana-detail-label">Load</span><span class="dana-detail-value">{{target.loadNumber || target.visitReference}}</span><span class="dana-cell-sub" *ngIf="target.loadNumber">{{target.visitReference}}</span></div>
          <div class="dana-detail"><span class="dana-detail-label">Dock</span><span class="dana-detail-value">{{target.dockCode || '—'}}</span></div>
          <div class="dana-detail"><span class="dana-detail-label">Driver</span><span class="dana-detail-value">{{target.driverName}}</span></div>
          <div class="dana-detail"><span class="dana-detail-label">Trailer</span><span class="dana-detail-value">{{target.trailerId || '—'}}</span></div>
        </div>
        <p class="dana-note" *ngIf="target.scannedDeliveryNumbers?.length"><b>SAP Delivery Number(s):</b> {{target.scannedDeliveryNumbers?.join(', ')}} — saved to this visit; this doesn't mean a PDF is attached.</p>

        <section class="dana-card-section tl-stack" [attr.data-tone]="packingSlipAvailable && !loadError ? 'success' : null">
          <div class="dana-card-header">
            <div><span class="dana-card-eyebrow">Packing slip</span><b>{{loading ? 'Loading packing slip…' : (packingSlipAvailable ? 'Ready to print' : 'PDF unavailable — checkout allowed')}}</b></div>
            <span class="dana-status-badge is-plain" [attr.data-tone]="packingSlipAvailable && !loadError ? 'success' : (detailsFailed ? 'warning' : 'neutral')">{{packingSlipAvailable && !loadError ? 'Ready' : (detailsFailed ? 'Retry' : 'Missing')}}</span>
          </div>
          <div *ngIf="packingSlip"><span class="dana-card-eyebrow">SAP Document / Delivery ID</span><b>{{packingSlip.extractedDocumentId || 'Needs review'}}</b><span class="dana-cell-sub" *ngIf="!packingSlip.extractedDocumentId">{{packingSlip.extractionMessage || 'SAP ID was not detected; print the saved PDF and finish checkout.'}}</span></div>
          <p class="dana-field-error" *ngIf="loadError">{{loadError}}</p>
          <button class="dana-btn dana-btn-primary dana-btn-block" type="button" [disabled]="loading || busy || !packingSlipAvailable" (click)="openPackingSlip()">{{slipOpened ? 'Open / Print Again' : 'Open / Print Packing Slip'}}</button>
          <p class="dana-field-hint" *ngIf="slipOpened">Packing slip opened for printing. Finish printing, then complete checkout.</p>
        </section>

        <p class="dana-alert" [class.dana-alert-success]="!detailsFailed && (!packingSlipAvailable || slipOpened)" [class.dana-alert-warning]="detailsFailed">
          <b>{{detailsFailed ? 'Visit refresh required.' : (!packingSlipAvailable ? 'No PDF — checkout allowed.' : (slipOpened ? 'Print step done.' : 'Print the packing slip first.'))}}</b>
          {{detailsFailed ? 'Return and retry to verify the visit.' : (!packingSlipAvailable ? 'Missing paperwork stays marked missing; it does not stop the truck leaving.' : (slipOpened ? 'You can finish Final Checkout now.' : 'Open the packing slip for printing before finishing.'))}}
        </p>
      </div>
      <div class="dana-dialog-actions"><button class="dana-btn" type="button" (click)="cancel()">Return</button><button class="dana-btn dana-btn-success" type="button" [disabled]="busy || loading || detailsFailed || (packingSlipAvailable && !slipOpened)" (click)="confirm()">{{busy ? 'Checking Out…' : 'Finish Final Checkout'}}</button></div>
    </div>
  </div>`,
})
export class FinalCheckoutDialogComponent implements OnInit, OnDestroy {
  /** The visit row the guard selected; the full visit is reloaded on open. */
  @Input({ required: true }) visit!: TruckVisitRecord;
  /** Unique id for the dialog heading (aria-labelledby). */
  @Input() titleId = 'final-checkout-title';
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly completed = new EventEmitter<TruckVisitRecord>();

  target!: TruckVisitRecord;
  busy = false;
  loading = false;
  loadError = '';
  slipOpened = false;
  detailsFailed = false;
  fileMissing = false;
  private printProof = '';
  private request = 0;
  private destroyed = false;
  private readonly pdfUrl = new ObjectUrlSlot();

  constructor(private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  ngOnInit() {
    this.target = this.visit;
    const request = ++this.request;
    const requestedId = this.visit.id;
    this.loading = true;
    this.api.visit(requestedId).subscribe({
      next: (fullVisit) => {
        if (this.destroyed || request !== this.request) return;
        this.target = fullVisit;
        this.loading = false;
        if (!this.packingSlipAvailable) {
          this.loadError = 'No available packing-slip PDF. You may finish checkout; paperwork remains marked missing.';
        }
      },
      error: () => {
        if (this.destroyed || request !== this.request) return;
        this.loading = false;
        this.detailsFailed = true;
        this.loadError = 'Could not refresh the visit. Return and retry Final Checkout.';
      },
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    ++this.request;
    this.pdfUrl.release();
  }

  get packingSlip(): VisitDocumentRecord | null {
    return this.target?.documents?.find((document) => document.documentType === 'PACKING_SLIP') ?? null;
  }

  get packingSlipAvailable(): boolean {
    return Boolean(this.packingSlip && this.packingSlip.fileAvailable !== false && !this.fileMissing);
  }

  cancel() {
    if (this.busy) return;
    ++this.request;
    this.closed.emit();
  }

  openPackingSlip() {
    const slip = this.packingSlip;
    if (!slip || !this.packingSlipAvailable || this.busy || this.loading) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      this.toast.warning('Allow pop-ups for Truck Log to print the available packing slip.', 'Print window blocked');
      return;
    }
    try { popup.opener = null; } catch { /* Browser restriction. */ }
    const request = this.request;
    this.loading = true;
    this.api.documentBlob(slip.id).subscribe({
      next: (response) => {
        if (this.destroyed || request !== this.request) { popup.close(); return; }
        this.loading = false;
        if (popup.closed) { this.toast.warning('The preview window was closed. Open the PDF again.', 'Print not opened'); return; }
        const blob = response.body;
        const proof = response.headers.get('X-TruckLog-Checkout-Print-Proof') || '';
        if (!blob || !proof) {
          popup.close();
          this.toast.warning('The server did not confirm the packing-slip preview. Refresh and open the PDF again.', 'Print not confirmed');
          return;
        }
        popup.location.href = this.pdfUrl.open(blob);
        this.printProof = proof;
        this.slipOpened = true;
        this.loadError = '';
      },
      error: (error) => {
        popup.close();
        if (this.destroyed || request !== this.request) return;
        this.loading = false;
        if (error?.status === 404) {
          this.fileMissing = true;
          this.printProof = '';
          this.loadError = 'The saved PDF is no longer available. Final checkout is allowed without it.';
        } else {
          this.toast.warning('Could not open the PDF. Check the connection and retry printing.', 'PDF could not be opened');
        }
      },
    });
  }

  confirm() {
    if (this.busy) return;
    if (this.loading || this.detailsFailed || (this.packingSlipAvailable && !this.slipOpened)) {
      this.toast.warning(this.detailsFailed ? 'Return and refresh the visit before checkout.' : 'Open and print the available packing slip before finishing.', 'Checkout not ready');
      return;
    }
    const visit = this.target;
    this.busy = true;
    this.api.finalCheckout(visit.id, 'Guard', this.printProof).subscribe({
      next: () => {
        this.busy = false;
        this.printProof = '';
        this.toast.success(`${visit.driverName} is fully checked out and off site.`, 'Final checkout complete');
        this.completed.emit(visit);
      },
      error: (e) => {
        this.busy = false;
        this.toast.error(e?.error?.message || 'Final checkout failed.', 'Final checkout failed');
      },
    });
  }
}
