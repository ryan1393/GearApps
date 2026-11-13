import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { TruckLogApi } from '@truck-log/web/data-access';

interface GatePrinterPair { eastPrinter: string; westPrinter: string; }
const WORKSTATION_GATE_KEY = 'truckLogGuardGate';

/** Browser controls only: this component never installs a queue or sends a print job. */
@Component({
  selector: 'tl-gate-printing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="tl-admin-columns">
  <section class="dana-panel" data-truck-log-printing="gate">
    <div class="dana-panel-header">
      <div><h2>Gate printers</h2><small>Saved centrally in Truck Log</small></div>
    </div>
    <div class="dana-panel-body tl-stack">
      <p class="dana-page-description">East Gate check-ins print on the East printer; West Gate check-ins print on the West printer. Enter the exact names the Windows Print Agent sees, including the full share path for shared printers.</p>
      <p class="dana-loading-state" *ngIf="loading" role="status">Loading printer settings…</p>
      <div class="dana-alert dana-alert-danger tl-admin-retry" *ngIf="loadError" role="alert">
        <span>{{loadError}}</span>
        <button type="button" class="dana-btn dana-btn-sm" [disabled]="loading || saving" (click)="loadPrinters()">Retry</button>
      </div>
      <form class="tl-stack" (ngSubmit)="savePrinters()" *ngIf="loaded">
        <label class="dana-field" for="gate-east-printer">East Gate printer
          <input class="dana-input" id="gate-east-printer" name="eastPrinter" type="text" maxlength="255" autocomplete="off" spellcheck="false" [(ngModel)]="eastPrinter" [disabled]="loading || saving" (ngModelChange)="printerEdited()">
        </label>
        <label class="dana-field" for="gate-west-printer">West Gate printer
          <input class="dana-input" id="gate-west-printer" name="westPrinter" type="text" maxlength="255" autocomplete="off" spellcheck="false" [(ngModel)]="westPrinter" [disabled]="loading || saving" (ngModelChange)="printerEdited()">
        </label>
        <p class="dana-field-hint">Save even when the default names already appear. Changing a printer does not reroute a job that is already queued.</p>
        <p class="dana-alert dana-alert-danger" *ngIf="validationError" role="alert">{{validationError}}</p>
        <p class="dana-alert dana-alert-danger" *ngIf="saveError" role="alert">{{saveError}}</p>
        <p class="dana-alert dana-alert-success" *ngIf="saveMessage" role="status">{{saveMessage}}</p>
        <div class="dana-actions">
          <button class="dana-btn dana-btn-primary" type="submit" [disabled]="!canSave">{{saving ? 'Saving…' : 'Save printers'}}</button>
          <button class="dana-btn" type="button" [disabled]="loading || saving || dirty" (click)="loadPrinters()">Reload saved printers</button>
        </div>
      </form>
    </div>
  </section>
  <section class="dana-panel">
    <div class="dana-panel-header"><div><h2>This workstation</h2><small>Gate for this browser only</small></div></div>
    <div class="dana-panel-body tl-stack">
      <p class="dana-page-description">Choose East Gate on the East guard computer and West Gate on the West guard computer. The choice is stored in this browser; clearing browser data removes it.</p>
      <div class="dana-filter-row">
        <label for="printing-workstation-gate">This workstation is
          <select id="printing-workstation-gate" name="workstationGate" [(ngModel)]="workstationGate" (ngModelChange)="workstationEdited()">
            <option value="">Choose gate</option><option value="EAST">East Gate</option><option value="WEST">West Gate</option>
          </select>
        </label>
        <div class="dana-actions tl-filter-actions"><button type="button" class="dana-btn dana-btn-primary" [disabled]="!validWorkstationGate" (click)="saveWorkstationGate()">Save workstation gate</button></div>
      </div>
      <p class="dana-alert dana-alert-danger" *ngIf="workstationError" role="alert">{{workstationError}}</p>
      <p class="dana-alert dana-alert-success" *ngIf="workstationMessage" role="status">{{workstationMessage}}</p>
      <p class="dana-note">These are routing settings only. Saving does not prove a Print Agent is online or that a page printed, and the SAP Print Server INI is not changed.</p>
    </div>
  </section>
  </div>`
})
export class GatePrintingComponent implements OnInit, OnDestroy {
  eastPrinter = '';
  westPrinter = '';
  workstationGate = '';
  loading = false;
  saving = false;
  loaded = false;
  dirty = false;
  loadError = '';
  saveError = '';
  saveMessage = '';
  workstationError = '';
  workstationMessage = '';
  private readonly subscriptions = new Subscription();
  private requestNumber = 0;
  private destroyed = false;

  constructor(private readonly api: TruckLogApi) {}

  ngOnInit(): void {
    this.readWorkstationGate();
    this.loadPrinters();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.requestNumber++;
    this.subscriptions.unsubscribe();
  }

  get validationError(): string {
    if (!this.loaded) return '';
    if (typeof this.eastPrinter !== 'string' || typeof this.westPrinter !== 'string') return 'Both printer names are required.';
    const east = this.eastPrinter.trim(), west = this.westPrinter.trim();
    if (!east || !west) return 'Both East and West printer names are required.';
    if (east.length > 255 || west.length > 255 || /[\u0000-\u001f\u007f]/.test(east + west)) return 'Printer names must be at most 255 characters and contain no control characters.';
    if (east.toLowerCase() === west.toLowerCase()) return 'East and West must use different printers.';
    return '';
  }
  get canSave(): boolean { return this.loaded && !this.loading && !this.saving && !this.validationError && !this.destroyed; }
  get validWorkstationGate(): boolean { return this.workstationGate === 'EAST' || this.workstationGate === 'WEST'; }

  printerEdited(): void { this.dirty = true; this.saveMessage = ''; this.saveError = ''; }
  workstationEdited(): void { this.workstationMessage = ''; this.workstationError = ''; }

  loadPrinters(): void {
    if (this.destroyed || this.loading || this.saving || this.dirty) return;
    const request = ++this.requestNumber;
    this.loading = true;
    this.loadError = '';
    this.saveMessage = '';
    this.saveError = '';
    this.subscriptions.add(this.api.gatePrintingSettings().subscribe({
      next: (response) => {
        if (this.destroyed || request !== this.requestNumber) return;
        const pair = this.readPair(response);
        this.loading = false;
        if (!pair) { this.loaded = false; this.loadError = 'Truck Log returned invalid printer settings. No settings have been changed.'; return; }
        this.eastPrinter = pair.eastPrinter;
        this.westPrinter = pair.westPrinter;
        this.loaded = true;
        this.dirty = false;
      },
      error: () => {
        if (this.destroyed || request !== this.requestNumber) return;
        this.loading = false;
        this.loaded = false;
        this.loadError = 'Could not load printer settings from Truck Log. Check that the Truck Log server is running, then retry.';
      },
    }));
  }

  savePrinters(): void {
    if (!this.canSave) return;
    const submitted: GatePrinterPair = { eastPrinter: this.eastPrinter.trim(), westPrinter: this.westPrinter.trim() };
    const request = ++this.requestNumber;
    this.saving = true;
    this.saveError = '';
    this.saveMessage = '';
    this.subscriptions.add(this.api.updateGatePrintingSettings(submitted).subscribe({
      next: (response) => {
        if (this.destroyed || request !== this.requestNumber) return;
        this.saving = false;
        const saved = this.readPair(response);
        if (!saved || saved.eastPrinter !== submitted.eastPrinter || saved.westPrinter !== submitted.westPrinter) {
          this.saveError = 'The server response did not confirm the submitted names. Leave this tab and reopen it to check the saved settings before retrying.';
          return;
        }
        this.eastPrinter = saved.eastPrinter;
        this.westPrinter = saved.westPrinter;
        this.dirty = false;
        this.saveMessage = 'East and West printer names saved on the Truck Log server.';
      },
      error: () => {
        if (this.destroyed || request !== this.requestNumber) return;
        this.saving = false;
        this.saveError = 'The save could not be confirmed. Your entries are retained. Reopen this tab to check the saved values before retrying.';
      },
    }));
  }

  private readPair(value: unknown): GatePrinterPair | null {
    if (!value || typeof value !== 'object') return null;
    const pair = value as Partial<GatePrinterPair>;
    if (typeof pair.eastPrinter !== 'string' || typeof pair.westPrinter !== 'string') return null;
    // Match the service validation; never turn objects into apparent printer names.
    for (const name of [pair.eastPrinter, pair.westPrinter]) {
      if (!name.trim() || name.trim().length > 255 || /[\u0000-\u001f\u007f]/.test(name.trim())) return null;
    }
    if (pair.eastPrinter.trim().toLowerCase() === pair.westPrinter.trim().toLowerCase()) return null;
    return { eastPrinter: pair.eastPrinter, westPrinter: pair.westPrinter };
  }

  private readWorkstationGate(): void {
    try {
      const gate = String(localStorage.getItem(WORKSTATION_GATE_KEY) || '').trim().toUpperCase();
      this.workstationGate = gate === 'EAST' || gate === 'WEST' ? gate : '';
      if (this.workstationGate) this.workstationMessage = (gate === 'EAST' ? 'East' : 'West') + ' Gate is saved for this browser.';
    } catch {
      this.workstationError = 'Browser storage is unavailable. Allow storage for this Truck Log site before saving the workstation gate.';
    }
  }
  saveWorkstationGate(): void {
    if (this.destroyed || !this.validWorkstationGate) return;
    this.workstationError = '';
    this.workstationMessage = '';
    try {
      localStorage.setItem(WORKSTATION_GATE_KEY, this.workstationGate);
      if (localStorage.getItem(WORKSTATION_GATE_KEY) !== this.workstationGate) throw new Error('Storage read-back failed.');
      this.workstationMessage = (this.workstationGate === 'EAST' ? 'East' : 'West') + ' Gate saved for this browser only.';
    } catch {
      this.workstationError = 'The workstation gate could not be saved. Allow browser storage for this site and try again.';
    }
  }
}
