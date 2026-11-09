import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import type { DockScanCandidate, DockScanLookup, DockDeliveryScanReceipt, TruckVisitRecord, VisitDocumentRecord } from '@truck-log/shared/contracts';
import { ObjectUrlSlot, TruckLogApi } from '@truck-log/web/data-access';
import { TruckLogDialogDirective } from '@truck-log/web/ui';
import { DockScanInput } from './dock-scan-input';

@Component({
  selector: 'app-dock-packing-scan', standalone: true, imports: [CommonModule, TruckLogDialogDirective],
  template: `
  <div class="dana-dialog-backdrop" data-dock-scan="enabled" data-delivery-save="enabled" data-manual-entry="enabled" data-save-close="enabled" (click)="close()">
    <section class="dana-dialog tl-scan-dialog" tlDialog="dock-scan-title" [tlDialogEscape]="!attaching && !saving" (tlDialogClose)="close()" (click)="$event.stopPropagation()" (keydown)="scanDialogKey($event)">
      <div class="dana-dialog-header"><h2 id="dock-scan-title">SAP Delivery Number</h2>
      <p>Load {{visit.loadNumber || visit.visitReference}} · Dock {{visit.dockCode}} · {{visit.driverName}} · Trailer {{visit.trailerId}}</p></div>
      <div class="dana-dialog-body tl-stack">
      <p class="dana-note">Scan or type the eight-digit Delivery Number. It is saved to this visit even without a PDF.<span *ngIf="closeAfterSave"> The scanner's Enter key saves it and closes this window once the server confirms.</span></p>
      <div class="dana-segmented" role="group" aria-label="Delivery Number entry method">
        <button type="button" [attr.aria-pressed]="entryMode === 'SCAN'" [disabled]="busy" (click)="setEntryMode('SCAN')">Use Scanner</button>
        <button type="button" [attr.aria-pressed]="entryMode === 'MANUAL'" [disabled]="busy" (click)="setEntryMode('MANUAL')">Type It</button>
      </div>
      <form class="dana-field tl-stack" *ngIf="waiting && entryMode === 'MANUAL'" (submit)="saveManual($event)" novalidate>
        <label for="dock-delivery-manual">SAP Delivery Number — 8 digits</label>
        <input #manualField id="dock-delivery-manual" name="deliveryNumber" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"
          [value]="manualNumber" (input)="manualInput($event)" [disabled]="busy" aria-describedby="dock-manual-help"
          (keydown.escape)="close(); $event.stopPropagation()">
        <small id="dock-manual-help" class="dana-field-hint">No scanner needed. Keep any leading zeros. Check this number against the paperwork before saving.</small>
        <button type="submit" class="dana-btn dana-btn-primary" [disabled]="busy || !manualValid()"><ng-container *ngIf="closeAfterSave; else findPdfLabel">Save Number &amp; Close</ng-container><ng-template #findPdfLabel>Save Number &amp; Find PDF</ng-template></button>
      </form>
      <div #receiver class="dana-empty-state tl-scan-receiver" tabindex="0" role="group" aria-label="Barcode scanner capture area"
        *ngIf="waiting && entryMode === 'SCAN'" (keydown)="scanKey($event)" (blur)="resetBurst()"
        (paste)="rejectManual($event)" (drop)="rejectManual($event)" (beforeinput)="rejectManual($event)">
        <b>Waiting for scan…</b><span *ngIf="closeAfterSave">Scan the eight-digit number. The scanner's Enter key saves it and closes this window.</span><span *ngIf="!closeAfterSave">Click here, then scan. The scanner's Enter key saves the number, then looks for a PDF.</span>
      </div>
      <p class="dana-field-hint" role="status" aria-live="polite">{{message}}</p>
      <p class="dana-alert dana-alert-success" *ngIf="savedReceipt" role="status"><b>Delivery {{savedReceipt.deliveryNumber}} saved to this visit.</b>
        <span>Saved {{captureTime(savedReceipt.savedAt)}}{{savedReceipt.alreadySaved ? ' — already on this visit' : ''}}. {{savedReceipt.entryMethod === 'MANUAL' ? 'Originally entered manually. ' : (savedReceipt.entryMethod === 'SCAN' ? 'Originally entered in scanner mode. ' : '')}}PDF attachment is separate.</span></p>
      <p class="dana-muted" *ngIf="visit.scannedDeliveryNumbers?.length"><b>Saved on this visit:</b> {{visit.scannedDeliveryNumbers?.join(', ')}}</p>
      <ul class="dana-file-list" *ngIf="lookup?.candidates?.length"><li *ngFor="let item of lookup?.candidates">
        <div><b>{{item.fileName}}</b><small>Captured {{captureTime(item.capturedAt)}}
          · PDF {{item.documentId}} · {{item.sha256.slice(0,12)}}</small></div>
        <button type="button" class="dana-btn dana-btn-sm" [disabled]="busy" (click)="preview(item)">{{item.alreadyAttached ? 'Open Attached PDF' : 'Open PDF to Review'}}</button>
      </li></ul>
      <section class="dana-alert tl-stack" *ngIf="selected && previewToken">
        <b>Confirm this PDF belongs to {{visit.loadNumber || visit.visitReference}}.</b>
        <p>SAP Delivery {{selected.deliveryNumber}} · PDF {{selected.documentId}}</p>
        <p *ngIf="lookup?.currentDocument && !selected.alreadyAttached">This replaces the current packing slip.
          The previous PDF and its association history are retained.</p>
        <button type="button" class="dana-btn dana-btn-primary" [disabled]="busy" (click)="attach()">
          {{busy ? 'Attaching…' : (selected.alreadyAttached ? 'Confirm Current PDF' : 'Confirm & Attach to This Visit')}}
        </button>
      </section>
      <p class="dana-field-hint">Missing PDF? Upload is optional. Dock Complete and checkout remain available.</p>
      </div>
      <div class="dana-dialog-actions"><button type="button" class="dana-btn" [disabled]="attaching || saving" (click)="close()">Close</button>
        <button type="button" class="dana-btn" [disabled]="busy" (click)="arm()">{{entryMode === 'MANUAL' ? 'Enter Another Number / Retry' : 'Scan Again'}}</button></div>
    </section>
  </div>`,
})
export class DockScanComponent implements OnDestroy {
  @Input() visit!: TruckVisitRecord;
  // Dock Board enables fast save/close; explicit PDF review retains the previous flow.
  @Input() closeAfterSave = false;
  @Output() saved = new EventEmitter<DockDeliveryScanReceipt>();
  @Output() attached = new EventEmitter<VisitDocumentRecord>();
  @Output() closed = new EventEmitter<void>();
  @ViewChild('receiver') set receiver(value: ElementRef<HTMLElement> | undefined) {
    this.receiverElement = value?.nativeElement;
    if (value) queueMicrotask(() => { if (!this.destroyed && this.waiting && this.entryMode === 'SCAN') value.nativeElement.focus(); });
  }
  @ViewChild('manualField') set manualField(value: ElementRef<HTMLInputElement> | undefined) {
    this.manualElement = value?.nativeElement;
    if (value) queueMicrotask(() => { if (!this.destroyed && this.waiting && this.entryMode === 'MANUAL') value.nativeElement.focus(); });
  }
  entryMode: 'SCAN' | 'MANUAL' = 'SCAN';
  manualNumber = '';
  waiting = true;
  busy = false;
  attaching = false;
  saving = false;
  savedReceipt: DockDeliveryScanReceipt | null = null;
  message = '';
  lookup: DockScanLookup | null = null;
  selected: DockScanCandidate | null = null;
  previewToken = '';
  private receiverElement?: HTMLElement;
  private manualElement?: HTMLInputElement;
  private readonly input = new DockScanInput();
  private readonly subscriptions = new Subscription();
  /** Only the PDF currently under review keeps a blob URL. */
  private readonly previewUrl = new ObjectUrlSlot();
  private destroyed = false;
  private request = 0;
  private dialogScanPending = false;
  constructor(private readonly api: TruckLogApi) {}
  ngOnDestroy(): void { this.destroyed = true; ++this.request; this.subscriptions.unsubscribe(); this.previewUrl.release(); }
  captureTime(value: string): string {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(parsed) + ' ET' : 'Time unavailable';
  }
  resetBurst(): void { this.input.reset(); this.dialogScanPending = false; }
  rejectManual(event: Event): void { event.preventDefault(); this.resetBurst(); this.message = 'Use the scanner here, or choose Manual Entry to type the number.'; }
  setEntryMode(mode: 'SCAN' | 'MANUAL'): void {
    if (this.destroyed || this.busy || this.saving || this.attaching || (mode !== 'SCAN' && mode !== 'MANUAL')) return;
    this.entryMode = mode;
    this.arm();
  }
  manualInput(event: Event): void {
    if (this.destroyed || this.busy || this.entryMode !== 'MANUAL' || !this.waiting) return;
    const value = (event.target as HTMLInputElement | null)?.value;
    this.manualNumber = typeof value === 'string' ? value : '';
    this.message = '';
  }
  manualValid(): boolean {
    // Never drop/truncate digits: a 9-digit typo must not become a different valid ID.
    return this.manualNumber.length === 8 && /^[0-9]{8}$/.test(this.manualNumber);
  }
  saveManual(event: Event): void {
    event.preventDefault(); event.stopPropagation();
    if (this.destroyed || this.busy || this.entryMode !== 'MANUAL' || !this.waiting) return;
    if (!this.manualValid()) { this.message = 'Enter exactly eight digits, including any leading zeros. Nothing was saved.'; return; }
    this.saveAndLookup(this.manualNumber, 'MANUAL');
  }
  arm(): void {
    if (this.destroyed || this.busy) return;
    ++this.request; this.resetBurst(); this.lookup = null; this.selected = null; this.previewToken = ''; this.message = ''; this.savedReceipt = null;
    this.waiting = true;
    // Focus an existing receiver; its ViewChild setter also focuses a newly created receiver.
    queueMicrotask(() => { if (!this.destroyed && this.waiting) { if (this.entryMode === 'MANUAL') this.manualElement?.focus(); else this.receiverElement?.focus(); } });
  }
  close(): void { if (!this.attaching && !this.saving) { ++this.request; this.closed.emit(); } }
  // Scoped to this open dialog only. A scan also works when a dialog button has focus.
  // A plain Enter still activates that button; editable/manual fields are never captured.
  scanDialogKey(event: KeyboardEvent): void {
    if (this.destroyed || this.entryMode !== 'SCAN' || !this.waiting || this.busy || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input,textarea,select,[contenteditable]')) return;
    if (/^[0-9]$/.test(event.key) || (event.key === 'Enter' && this.dialogScanPending)) {
      this.scanKey(event);
    } else {
      this.resetBurst();
    }
  }
  scanKey(event: KeyboardEvent): void {
    if (this.destroyed || this.entryMode !== 'SCAN' || !this.waiting || this.busy) return;
    if (event.key === 'Tab') { this.resetBurst(); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { this.close(); return; }
    this.dialogScanPending = event.key !== 'Enter';
    const result = this.input.feed(event);
    if (result.type === 'rejected') { this.message = 'Scan the whole eight-digit Delivery Number followed by Enter. Slow or incomplete entry is not accepted.'; return; }
    if (result.type !== 'complete') return;
    this.saveAndLookup(result.value, 'SCAN');
  }
  private saveAndLookup(deliveryNumber: string, mode: 'SCAN' | 'MANUAL'): void {
    if (this.destroyed || this.busy) return;
    this.waiting = false; this.busy = true; this.saving = true; this.savedReceipt = null;
    this.message = mode === 'MANUAL' ? 'Saving manually entered Delivery Number to this visit…' : 'Saving scanned Delivery Number to this visit…';
    const request = ++this.request;
    const visitId = this.visit.id;
    const closeAfterSave = this.closeAfterSave;
    // A timeout/lost response is NOT proof of failure: reopen the visit or rescan
    // to reconcile. Same-visit/same-number saves are idempotent on the server.
    const watchdog = setTimeout(() => {
      if (this.destroyed || request !== this.request || !this.saving) return;
      ++this.request; this.saving = false; this.busy = false;
      this.message = 'Save not confirmed. Reopen this visit to check, or retry the number. PDF lookup was not started.';
    }, 20000);
    this.subscriptions.add({ unsubscribe: () => clearTimeout(watchdog) });
    const save = mode === 'MANUAL' ? this.api.saveManualDeliveryNumber(visitId, deliveryNumber) :
      this.api.saveScannedDeliveryNumber(visitId, deliveryNumber);
    this.subscriptions.add(save.subscribe({
      next: (receipt) => {
        clearTimeout(watchdog);
        if (this.destroyed || request !== this.request || this.visit.id !== visitId) return;
        this.saving = false;
        if (!receipt || receipt.visitId !== visitId || receipt.deliveryNumber !== deliveryNumber ||
            !Number.isSafeInteger(receipt.eventId) || receipt.eventId <= 0 ||
            typeof receipt.alreadySaved !== 'boolean' || typeof receipt.savedAt !== 'string' || !Number.isFinite(Date.parse(receipt.savedAt)) ||
            (receipt.entryMethod !== undefined && receipt.entryMethod !== 'SCAN' && receipt.entryMethod !== 'MANUAL') ||
            (mode === 'MANUAL' && (!receipt.entryMethod || (!receipt.alreadySaved && receipt.entryMethod !== 'MANUAL')))) {
          this.busy = false; this.message = 'Save response did not match this entry. Reopen the visit to verify; no PDF lookup was started.'; return;
        }
        this.savedReceipt = receipt;
        this.visit.scannedDeliveryNumbers = [...new Set([...(this.visit.scannedDeliveryNumbers || []), receipt.deliveryNumber])];
        if (closeAfterSave) {
          this.busy = false;
          this.message = 'Delivery Number saved to this visit.';
          this.saved.emit(receipt);
          this.close();
          return; // No PDF request or automatic attachment is part of fast save/close.
        }
        this.message = 'Delivery Number saved. Looking for an optional matching PDF…';
        this.subscriptions.add(this.api.scanPackingSlip(visitId, deliveryNumber).subscribe({
          next: (lookup) => {
            if (this.destroyed || request !== this.request || this.visit.id !== visitId) return;
            this.busy = false;
            if (lookup.visitId !== visitId || lookup.deliveryNumber !== deliveryNumber) {
              this.message = 'Delivery Number saved, but the PDF lookup response did not match. No PDF was attached.'; return;
            }
            this.lookup = lookup; this.message = lookup.message;
          },
          error: (error) => { if (!this.destroyed && request === this.request && this.visit.id === visitId) {
            this.busy = false; this.message = 'Delivery Number is saved. PDF lookup could not be completed. ' + this.errorText(error);
          } },
        }));
      },
      error: (error) => {
        clearTimeout(watchdog);
        if (!this.destroyed && request === this.request && this.visit.id === visitId) {
          this.saving = false; this.busy = false;
          this.message = 'Delivery Number save not confirmed. Reopen the visit to verify, or retry the number. ' + this.saveErrorText(error);
        }
      },
    }));
  }
  preview(candidate: DockScanCandidate): void {
    if (this.busy) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) { this.message = 'Allow pop-ups for Truck Log to review the PDF. Nothing was attached.'; return; }
    try { popup.opener = null; } catch { /* Best effort. */ }
    this.selected = null; this.previewToken = ''; this.busy = true; this.message = 'Opening the selected PDF…';
    const request = ++this.request;
    this.subscriptions.add(this.api.previewScannedPackingSlip(this.visit.id, candidate.selectionToken).subscribe({
      next: (response) => {
        if (this.destroyed || request !== this.request) { popup.close(); return; }
        this.busy = false;
        const token = response.headers.get('X-TruckLog-Scan-Preview');
        if (!response.body || response.body.size !== candidate.fileSizeBytes || !token || popup.closed) {
          popup.close(); this.message = 'PDF preview was not confirmed. Nothing was attached.'; return;
        }
        popup.location.href = this.previewUrl.open(response.body);
        this.selected = candidate; this.previewToken = token;
        this.message = 'Review the PDF in the opened tab, then confirm it belongs to the load shown here.';
      },
      error: (error) => { popup.close(); if (!this.destroyed && request === this.request) { this.busy = false; this.message = this.errorText(error); } },
    }));
  }
  attach(): void {
    if (this.busy || !this.selected || !this.previewToken) return;
    const expected = this.selected;
    this.busy = true; this.attaching = true;
    const request = ++this.request;
    this.subscriptions.add(this.api.attachScannedPackingSlip(this.visit.id, this.previewToken).subscribe({
      next: (doc) => {
        if (this.destroyed || request !== this.request) return;
        this.busy = false; this.attaching = false;
        if (doc.id !== expected.documentId || doc.truckVisitId !== this.visit.id || doc.sha256 !== expected.sha256 ||
            doc.extractedDocumentId !== expected.deliveryNumber || doc.documentType !== 'PACKING_SLIP') {
          this.previewToken = ''; this.message = 'Attachment response did not match. Refresh the visit before retrying.'; return;
        }
        this.attached.emit(doc);
      },
      error: (error) => { if (!this.destroyed && request === this.request) { this.busy = false; this.attaching = false; this.message = this.errorText(error); } },
    }));
  }
  private saveErrorText(error: any): string {
    if (error?.status === 0) return 'The Truck Log server could not be reached. Check the connection before retrying.';
    const detail = error?.error?.message;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.filter((item: unknown) => typeof item === 'string').join(' ');
    if (error?.status === 404) return 'HTTP 404: the save endpoint or selected visit was not found. Refresh the visit and check the deployed server.';
    return 'The server did not confirm this save' + (Number.isInteger(error?.status) ? ' (HTTP ' + error.status + ')' : '') + '.';
  }
  private errorText(error: any): string {
    return typeof error?.error?.message === 'string' ? error.error.message :
      'Could not complete the document request. No confirmed attachment. Close and retry, upload optionally, or continue without a PDF.';
  }
}
