import { TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subscription, timeout } from 'rxjs';
import { UploadIdempotency, newUploadIdempotencyKey, pdfUploadValidationError } from '@truck-log/web/data-access';
import { expediteFailureDetail, expediteFailureTime } from './expedite-failure-display';
import { formatExpediteEta } from './rxo-expedite-eta-format';
import { RxoExpediteStore, type ExpediteShipment, type ExpediteShipmentsResponse, type ExpediteStatus } from './rxo-expedite.store';
const EXPEDITE_DOCUMENT_SITE_KEY = 'fort-wayne-expedite';
@Component({
  selector: 'tl-rxo-expedite', standalone: true, imports: [CommonModule, FormsModule],
  template: `
  <section class="tl-stack" aria-label="RXO Expedite">
    <input #expediteDriverDocumentFile type="file" accept="application/pdf,.pdf" hidden
      aria-label="Choose Expedite driver document PDF"
      (change)="uploadExpediteDriverDocument($event)">
    <div class="tl-stack" [class.dana-panel-body]="mode === 'data'">
      <p *ngIf="loading" class="dana-loading-state" role="status">Reading Expedite configuration and acquisition status…</p>
      <p *ngIf="actionError" class="dana-alert dana-alert-danger" role="alert">{{actionError}}</p>
      <p *ngIf="message" class="dana-alert dana-alert-success" role="status">{{message}}</p>
      <ng-container *ngIf="status as s">
        <ng-container *ngIf="mode === 'health'">
          <section class="dana-panel" aria-label="RXO Expedite timer diagnostics">
            <div class="dana-panel-header">
              <div><h2>Timer diagnostics</h2><small>Scheduler heartbeat, phase, request status and clock alignment</small></div>
              <div class="dana-actions">
                <span class="dana-status-badge" [attr.data-tone]="expediteTimerStale ? 'danger' : (expediteNeedsReview ? 'warning' : 'success')">{{expediteTimerState}}</span>
                <button class="dana-btn dana-btn-sm" type="button" [attr.aria-expanded]="healthDiagnosticsOpen" (click)="healthDiagnosticsOpen=!healthDiagnosticsOpen">{{healthDiagnosticsOpen ? 'Hide details' : 'Show details'}}</button>
              </div>
            </div>
            <div class="dana-panel-body" [hidden]="!healthDiagnosticsOpen">
              <div class="dana-detail-grid">
                <div class="dana-detail"><span class="dana-detail-label">Scheduler heartbeat</span><span class="dana-detail-value">{{expediteHeartbeatAgeLabel}}</span><span class="dana-cell-sub">{{displayExportTime(s.scheduler?.schedulerHeartbeatAt ?? null)}}</span></div>
                <div class="dana-detail"><span class="dana-detail-label">API refresh age</span><span class="dana-detail-value">{{expediteApiAgeLabel}}</span><span class="dana-cell-sub">Expedite status endpoint</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Configured interval</span><span class="dana-detail-value">{{s.scheduler?.intervalMinutes ?? 30}} minutes</span><span class="dana-cell-sub">Change it under Settings &amp; Login</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Current trigger / phase</span><span class="dana-detail-value">Scheduled</span><span class="dana-cell-sub">{{s.scheduler?.state ?? 'NOT_STARTED'}}</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Scan started</span><span class="dana-detail-value">{{displayExportTime(s.scheduler?.currentStartedAt ?? null)}}</span><span class="dana-cell-sub">{{s.scheduler?.state === 'EXPORTING' ? 'Expedite export running' : 'No active scan'}}</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Next scheduled scan</span><span class="dana-detail-value">{{displayExportTime(s.scheduler?.nextRunAt ?? null)}}</span><span class="dana-cell-sub">{{s.scheduler?.state === 'EXPORTING' ? 'Recalculated after completion' : 'Waiting for next cycle'}}</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Last completed duration</span><span class="dana-detail-value">{{expediteDurationLabel}}</span><span class="dana-cell-sub">{{displayExportTime(s.scheduler?.lastCompletedAt ?? null)}}</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Browser time</span><span class="dana-detail-value">{{expediteBrowserTimeLabel}}</span><span class="dana-cell-sub">Server time not reported by Expedite</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Scheduler process</span><span class="dana-detail-value">{{expediteSchedulerProcessLabel}}</span><span class="dana-cell-sub">Dedicated Docker scheduler service</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Exporter child process</span><span class="dana-detail-value">{{expediteExporterProcessLabel}}</span><span class="dana-cell-sub">Playwright acquisition cycle</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Last exporter output</span><span class="dana-detail-value">{{expediteLastOutputLabel}}</span><span class="dana-cell-sub">{{s.acquisition.state}}</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Stall limits</span><span class="dana-detail-value">Bounded</span><span class="dana-cell-sub">Browser, list-readiness and download timeouts</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Recovery state</span><span class="dana-detail-value">{{expediteRecoveryState}}</span><span class="dana-cell-sub">Previous verified batch kept on review</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Last recovery outcome</span><span class="dana-detail-value">{{expediteRecoveryOutcome}}</span><span class="dana-cell-sub">Zero-row protection stays on</span></div>
                <div class="dana-detail"><span class="dana-detail-label">Last scheduler error</span><span class="dana-detail-value">{{s.scheduler?.lastErrorCode || '-'}}</span><span class="dana-cell-sub">Exporter source unchanged</span></div>
              </div>
            </div>
          </section>

          <div class="tl-rxo-columns">
            <section class="dana-panel">
              <div class="dana-panel-header"><div><h2>Expedite exporter</h2><small>Dedicated RXO Expedite acquisition service</small></div><span class="dana-status-badge" [attr.data-tone]="expediteExporterHealthy ? 'success' : 'warning'">{{expediteExporterStatus}}</span></div>
              <div class="dana-panel-body tl-stack">
                <div class="dana-detail-grid">
                  <div class="dana-detail"><span class="dana-detail-label">Exporter version</span><span class="dana-detail-value">{{s.version || '—'}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Runtime isolation</span><span class="dana-detail-value">Separate image</span><span class="dana-cell-sub">Dedicated RXO Expedite image</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Last successful scan</span><span class="dana-detail-value">{{displayExportTime(s.acquisition.lastSuccessfulExport)}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Last attempt started</span><span class="dana-detail-value">{{s.acquisition.lastAttemptAt ? displayExportTime(s.acquisition.lastAttemptAt) : 'Time not reported'}}</span></div>
                  <div class="dana-detail" *ngIf="expediteNeedsReview"><span class="dana-detail-label">Failure completed</span><span class="dana-detail-value">{{latestFailureAt ? displayExportTime(latestFailureAt) : 'Time not reported'}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Last duration</span><span class="dana-detail-value">{{expediteDurationLabel}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Next scan</span><span class="dana-detail-value">{{displayExportTime(s.scheduler?.nextRunAt ?? null)}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Last batch</span><span class="dana-detail-value">{{s.acquisition.sourceBatchId || s.scheduler?.lastSourceBatchId || '-'}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Window</span><span class="dana-detail-value">Freight on the move</span><span class="dana-cell-sub">Native Expedite list export</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Scan interval</span><span class="dana-detail-value">Every {{s.scheduler?.intervalMinutes ?? 30}} minutes</span></div>
                </div>
                <div class="dana-alert dana-alert-danger" *ngIf="s.acquisition.lastError || s.scheduler?.lastErrorCode"><b>Last Expedite error.</b> {{s.acquisition.lastError || s.scheduler?.lastErrorCode}} <p>{{latestFailureDetail}}</p>The previous verified batch is kept; standard RXO is unaffected.</div>
              </div>
            </section>

            <section class="dana-panel">
              <div class="dana-panel-header"><div><h2>Truck Log Expedite import</h2><small>Verified-batch database import</small></div><span class="dana-status-badge" [attr.data-tone]="s.database?.state === 'COMPLETE' ? 'success' : 'warning'">{{s.databaseIngestionEnabled ? 'Connected' : 'Migration required'}}</span></div>
              <div class="dana-panel-body tl-stack">
                <div class="dana-detail-grid">
                  <div class="dana-detail"><span class="dana-detail-label">Last imported batch</span><span class="dana-detail-value">{{s.database?.lastImportedBatch || '-'}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Import status</span><span class="dana-detail-value">{{s.database?.state || 'Not enabled'}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Imported at</span><span class="dana-detail-value">{{displayExportTime(s.database?.importedAt || null)}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Rows imported</span><span class="dana-detail-value">{{s.database?.rowCount ?? '-'}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Linked orders</span><span class="dana-detail-value">{{s.database?.linkedOrders ?? '-'}}</span></div>
                  <div class="dana-detail"><span class="dana-detail-label">Pending batch</span><span class="dana-detail-value">{{s.database?.pendingBatch || '-'}}</span></div>
                </div>
                <p class="dana-note" *ngIf="s.databaseIngestionEnabled">Each verified Expedite batch is copied into Truck Log automatically. A failed import keeps the previous good batch.</p>
                <p class="dana-note" *ngIf="!s.databaseIngestionEnabled">The Expedite database migration has not been applied yet. The verified native batch stays available and standard RXO is unaffected.</p>
                <p class="dana-alert dana-alert-danger" *ngIf="s.database?.errorMessage"><b>Last import error.</b> {{s.database?.errorMessage}}</p>
              </div>
            </section>
          </div>
          <p *ngIf="s.scheduler?.lastErrorCode" class="dana-alert dana-alert-warning" role="status">Scheduled export code {{s.scheduler?.lastErrorCode}}. The scheduler waits for the next interval; the previous verified batch stays available.</p>
        </ng-container>

      </ng-container>

      <!-- Shipments do not depend on the status request: keep the Data tab usable when status fails. -->
      <section *ngIf="mode === 'data'" class="tl-stack" aria-labelledby="expedite-shipments-title">
          <div class="tl-rxo-toolbar">
          <form class="dana-filter-row">
            <label class="tl-rxo-search"><span class="tl-filter-label">Search</span><input name="expediteSearch" type="search" [(ngModel)]="shipmentSearch" placeholder="Shipment, origin, destination, status, SCAC" aria-label="Search Expedite shipments"></label>
            <div class="dana-actions tl-filter-actions"><button class="dana-btn dana-btn-ghost" type="button" [disabled]="!shipmentSearch" (click)="shipmentSearch=''">Clear</button></div>
          </form>

          <div class="dana-actions tl-rxo-range">
            <span class="dana-muted" id="expedite-shipments-title">{{shipments?.storage === 'POSTGRESQL' ? 'Database copy of the latest verified batch' : 'Latest verified batch'}}<ng-container *ngIf="shipments"> · {{filteredShipments.length}} of {{shipments.rowCount}}</ng-container></span>
          </div>
          </div>

          <p *ngIf="shipmentsLoading" class="dana-loading-state" role="status">Loading verified Expedite shipments…</p>
          <p *ngIf="shipmentsError" class="dana-alert dana-alert-danger" role="alert">{{shipmentsError}}</p>

          <div class="dana-table-shell is-sticky-head" *ngIf="!shipmentsLoading && shipments"
            role="region" tabindex="0" aria-label="RXO Expedite shipments results">
            <table class="dana-table tl-wide-table" data-rxo-dataset="expedite">
              <caption class="dana-muted tl-rxo-caption">Open a row's details for authorization, SCAC, commodity, mode and ETA.</caption>
              <thead>
                <tr><th>Shipment #</th><th>Status</th><th>Route</th><th>Current location</th><th>Next stop / ETA</th><th>Driver documents</th></tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let row of filteredShipments; trackBy: trackShipment">
                  <tr [attr.data-tone]="row.critical ? 'warning' : null">
                    <td>
                      <!-- Same identity cell as the standard RXO tables: number and Details button spaced apart. -->
                      <div class="tl-rxo-identity">
                        <b>{{row.shipmentId}}</b>
                        <button class="dana-btn dana-btn-ghost dana-btn-sm tl-rxo-details" type="button"
                          [attr.aria-expanded]="expediteDetailsOpen(row)"
                          [attr.aria-label]="(expediteDetailsOpen(row) ? 'Hide' : 'Show') + ' details for Expedite shipment ' + row.shipmentId"
                          (click)="toggleExpediteDetails(row)">{{expediteDetailsOpen(row) ? 'Hide details' : 'Details'}}</button>
                      </div>
                    </td>
                    <td>
                      <span class="dana-status-badge" [attr.data-tone]="expediteStatusTone(row.etaStatus, row.critical)">{{row.etaStatus || (row.critical ? 'Critical' : 'Current')}}</span>
                      <span class="dana-cell-sub" *ngIf="row.critical">Critical shipment</span>
                    </td>
                    <td><span class="dana-cell-sub">{{expediteRouteLabel(row)}}</span>{{expediteRouteValue(row)}}</td>
                    <td>{{show(row.currentLocation)}}</td>
                    <td>
                      {{show(row.nextStop)}}
                      <span class="dana-cell-sub" data-rxo-eta-format="site-time" [attr.title]="'RXO export: ' + show(row.etaNextStop)">ETA {{displayExpediteEta(row.etaNextStop)}}</span>
                    </td>
                    <td>
                      <div class="tl-rxo-document" [attr.aria-busy]="documentUploadingKey === expediteShipmentKey(row)">
                        <span class="dana-status-badge" [attr.data-tone]="expediteDocumentTone(row)">{{expediteDocumentStatusLabel(row)}}</span>
                        <button class="dana-btn dana-btn-sm" type="button"
                          [disabled]="!!documentUploadingKey || expediteDirection(row) === 'UNKNOWN'"
                          [attr.aria-label]="(hasExpediteDriverDocument(row) ? 'Replace PDF for Expedite shipment ' : 'Upload PDF for Expedite shipment ') + row.shipmentId"
                          (click)="beginExpediteDocumentUpload(row, expediteDriverDocumentFile)">
                          {{documentUploadingKey === expediteShipmentKey(row) ? 'Uploading…' : (hasExpediteDriverDocument(row) ? 'Replace PDF' : 'Upload PDF')}}
                        </button>
                      </div>
                      <span class="dana-cell-sub" *ngIf="row.driverDocument?.fileName" [attr.title]="row.driverDocument?.fileName">{{row.driverDocument?.fileName}}{{row.driverDocument?.version ? ' · v' + row.driverDocument?.version : ''}}</span>
                      <span class="dana-cell-sub" *ngIf="expediteDirection(row) === 'UNKNOWN'">Direction needs review before upload.</span>
                    </td>
                  </tr>
                  <tr [hidden]="!expediteDetailsOpen(row)">
                    <td colspan="6">
                      <section class="tl-stack" [attr.aria-label]="'Expedite shipment details for ' + row.shipmentId">
                        <div class="dana-detail-grid">
                          <div class="dana-detail"><span class="dana-detail-label">Critical</span><span class="dana-detail-value">{{row.critical === true ? 'Yes' : row.critical === false ? 'No' : '—'}}</span></div>
                          <div class="dana-detail"><span class="dana-detail-label">Auth. code</span><span class="dana-detail-value">{{show(row.authCode)}}</span></div>
                          <div class="dana-detail"><span class="dana-detail-label">Origin</span><span class="dana-detail-value">{{show(row.originName)}}</span><span class="dana-cell-sub">{{show(row.origin)}}</span></div>
                          <div class="dana-detail"><span class="dana-detail-label">Destination</span><span class="dana-detail-value">{{show(row.destination)}}</span></div>
                          <div class="dana-detail"><span class="dana-detail-label">SCAC</span><span class="dana-detail-value">{{show(row.scac)}}</span></div>
                          <div class="dana-detail"><span class="dana-detail-label">Commodity</span><span class="dana-detail-value">{{show(row.commodity)}}</span></div>
                          <div class="dana-detail"><span class="dana-detail-label">Mode</span><span class="dana-detail-value">{{show(row.mode)}}</span></div>
                          <div class="dana-detail"><span class="dana-detail-label">ETA status</span><span class="dana-detail-value">{{show(row.etaStatus)}}</span><span class="dana-cell-sub">Next stop ETA {{displayExpediteEta(row.etaNextStop)}}</span></div>
                        </div>
                        <div class="dana-actions"><button class="dana-btn dana-btn-ghost dana-btn-sm" type="button" (click)="toggleExpediteDetails(row)">Close details</button></div>
                      </section>
                    </td>
                  </tr>
                </ng-container>
                <tr *ngIf="filteredShipments.length === 0">
                  <td colspan="6" class="dana-table-empty">{{shipmentSearch.trim() && shipments.rowCount ? 'No verified Expedite shipments match this search.' : 'No Expedite shipments are waiting in the latest verified batch.'}}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="dana-empty-state" *ngIf="!shipmentsLoading && !shipments && !shipmentsError">Expedite shipments have not loaded yet. Use Refresh to try again.</div>
        </section>

      <ng-container *ngIf="status as s">

        <div *ngIf="mode === 'settings'" class="tl-rxo-columns">
          <section class="dana-panel">
            <div class="dana-panel-header"><div><h2>Expedite scan schedule</h2><small>Recurring RXO Expedite export</small></div></div>
            <div class="dana-panel-body tl-stack">
              <div class="dana-form-grid">
                <label class="dana-field">Scan every (minutes)<input class="dana-input" type="number" min="1" max="1440" step="1" [(ngModel)]="settingsInterval" name="expediteInterval" (ngModelChange)="settingsDirty=true"></label>
                <label class="dana-field">Run when scheduler starts<select class="dana-select" [(ngModel)]="settingsSyncOnStart" name="expediteSyncOnStart" (ngModelChange)="settingsDirty=true"><option [ngValue]="true">Enabled</option><option [ngValue]="false">Disabled</option></select></label>
                <div class="dana-field"><span class="dana-field-head">Next scheduled export (ET)</span><span class="dana-field-static">{{displayExportTime(s.scheduler?.nextRunAt ?? null)}}</span></div>
              </div>
              <p class="dana-note">Expedite uses its own scheduler and never overlaps its own export. Changes go to the Expedite control file and the running scheduler picks them up.</p>
              <div class="dana-actions"><button class="dana-btn dana-btn-primary" type="button" [disabled]="settingsSaving || !settingsValid" (click)="saveSettings()">{{settingsSaving ? 'Saving…' : 'Save scan settings'}}</button></div>
            </div>
          </section>

          <section class="dana-panel">
            <div class="dana-panel-header">
              <div><h2>Expedite login</h2><small>Stored in the Docker credential volume</small></div>
              <div class="dana-actions">
                <span *ngIf="s.transportWarning" class="dana-status-badge" data-tone="warning">Internal HTTP</span>
                <span class="dana-status-badge" [attr.data-tone]="s.credentials.usernameConfigured ? 'success' : 'warning'">Username {{s.credentials.usernameConfigured ? 'saved' : 'missing'}}</span>
                <span class="dana-status-badge" [attr.data-tone]="s.credentials.passwordConfigured ? 'success' : 'warning'">Password {{s.credentials.passwordConfigured ? 'saved' : 'missing'}}</span>
              </div>
            </div>
            <div class="dana-panel-body tl-stack">
              <p *ngIf="!saveAllowed" class="dana-alert dana-alert-warning">{{saveBlockedReason}}</p>
              <form class="dana-form-grid" (ngSubmit)="save()" autocomplete="off">
                <label class="dana-field">Expedite username<input class="dana-input" name="expediteUsername" type="text" maxlength="256" autocomplete="off" [(ngModel)]="username" [disabled]="!saveAllowed || saving" (ngModelChange)="dirty=true"></label>
                <label class="dana-field">Expedite password<input class="dana-input" name="expeditePassword" type="password" maxlength="2048" autocomplete="new-password" [(ngModel)]="replacementPassword" [disabled]="!saveAllowed || saving" [placeholder]="s.credentials.passwordConfigured ? 'Saved — leave blank to keep' : 'Enter Expedite password'" (ngModelChange)="dirty=true"></label>
                <p class="dana-field-full dana-note">The password is never shown here or stored in the Truck Log database. Leave it blank to keep the saved password.</p>
                <div class="dana-field-full dana-actions"><button class="dana-btn dana-btn-primary" type="submit" [disabled]="!saveAllowed || saving || !username.trim() || (!s.credentials.passwordConfigured && !replacementPassword)">{{saving ? 'Saving…' : 'Save Expedite login'}}</button></div>
              </form>
            </div>
          </section>
        </div>
      </ng-container>
      <p *ngIf="mode === 'settings'" class="dana-muted">The native XLSX, batch history and verified boundary are kept. Standard RXO and Expedite logins are separate.</p>
    </div>
  </section>`
})
export class RxoExpediteComponent implements OnInit, OnDestroy {
  @Input() mode: 'data' | 'health' | 'settings' = 'data';
  /** Status and shipments come from the page's single Expedite poll (RxoExpediteStore). */
  readonly store = inject(RxoExpediteStore);
  private readonly destroyRef = inject(DestroyRef);
  shipmentSearch = '';
  expandedShipmentId = '';
  documentUploadTarget: ExpediteShipment | null = null;
  documentUploadingKey = '';
  private readonly uploadIdempotency = new UploadIdempotency();
  /** Upload problems shown above the shipment table. */
  uploadError = '';
  username = ''; replacementPassword = ''; dirty = false; saving = false; actionError = ''; message = '';
  settingsInterval = 30; settingsSyncOnStart = true; settingsDirty = false; settingsSaving = false;
  healthDiagnosticsOpen = false; clockNow = Date.now();
  private healthClockTimer: number | null = null;
  private readonly subs = new Subscription(); private stopped = false;
  constructor(private readonly http: HttpClient, public readonly adminAuth: TruckLogAdminAuth) {}
  get status(): ExpediteStatus | null { return this.store.status; }
  get shipments(): ExpediteShipmentsResponse | null { return this.store.shipments; }
  get statusReceivedAt(): number { return this.store.statusReceivedAt; }
  get loading(): boolean { return !this.store.status && !this.store.statusError; }
  get error(): string { return this.actionError || this.store.statusError; }
  get shipmentsLoading(): boolean { return !this.store.shipments && !this.store.shipmentsError; }
  get shipmentsError(): string { return this.uploadError || this.store.shipmentsError; }
  /** Pending upload key, kept for a retry of the same file. */
  get pendingDocumentUploadKey(): string { return this.uploadIdempotency.key; }
  get saveAllowed() { return this.adminAuth.canWrite() && this.status?.credentialUpdatesEnabled === true && this.status.controlOrigin === globalThis.location?.origin; }
  /** Why the Expedite login and schedule can't be changed from this browser right now. */
  get saveBlockedReason(): string {
    if (!this.adminAuth.canWrite()) return 'Sign in as an administrator to change the Expedite login and schedule.';
    const origin = this.status?.controlOrigin;
    if (this.status?.credentialUpdatesEnabled && origin && origin !== globalThis.location?.origin) {
      return `To change the Expedite login, open Truck Log at ${origin}.`;
    }
    return 'Expedite login changes are turned off on this server. Ask the Truck Log maintainer to check TRUCK_LOG_PUBLIC_ORIGIN in .env.';
  }
  get settingsValid() { return Number.isInteger(Number(this.settingsInterval)) && Number(this.settingsInterval) >= 1 && Number(this.settingsInterval) <= 1440; }
  displayExpediteEta(value: string | number | null): string { return formatExpediteEta(value); }
  displayExportTime(value: string | null): string {
    if (!value) return 'Not exported yet';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Timestamp requires review';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(date);
  }
  get filteredShipments(): ExpediteShipment[] { const q = this.shipmentSearch.trim().toLowerCase(); if (!q) return this.shipments?.shipments ?? []; return (this.shipments?.shipments ?? []).filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))); }
  trackShipment(_: number, row: ExpediteShipment) { return row.shipmentId; }
  expediteDetailsOpen(row: ExpediteShipment): boolean { return this.expandedShipmentId === row.shipmentId; }
  toggleExpediteDetails(row: ExpediteShipment): void { this.expandedShipmentId = this.expandedShipmentId === row.shipmentId ? '' : row.shipmentId; }
  private expediteIsFortWayne(value: string | null): boolean {
    return /\bfort\s+wayne\b/i.test(String(value ?? ''));
  }
  expediteDirection(row: ExpediteShipment): 'INBOUND' | 'OUTBOUND' | 'UNKNOWN' {
    const origin = [row.originName, row.origin].filter(Boolean).join(' ');
    const destination = String(row.destination ?? '');
    const originIsFortWayne = this.expediteIsFortWayne(origin);
    const destinationIsFortWayne = this.expediteIsFortWayne(destination);
    if (originIsFortWayne && !destinationIsFortWayne) return 'OUTBOUND';
    if (destinationIsFortWayne && !originIsFortWayne) return 'INBOUND';
    return 'UNKNOWN';
  }
  expediteRouteLabel(row: ExpediteShipment): string {
    const direction = this.expediteDirection(row);
    return direction === 'OUTBOUND' ? 'To' : direction === 'INBOUND' ? 'From' : 'Route';
  }
  expediteRouteValue(row: ExpediteShipment): string {
    const direction = this.expediteDirection(row);
    if (direction === 'OUTBOUND') return this.show(row.destination);
    if (direction === 'INBOUND') return this.show(row.originName || row.origin);
    return `${this.show(row.originName || row.origin)} → ${this.show(row.destination)}`;
  }


  expediteShipmentKey(row: ExpediteShipment): string {
    return [
      EXPEDITE_DOCUMENT_SITE_KEY,
      this.expediteDirection(row),
      row.shipmentId,
    ].map((value) => encodeURIComponent(String(value || '').trim())).join('|');
  }

  hasExpediteDriverDocument(row: ExpediteShipment): boolean {
    return Boolean(
      row.driverDocument
      && row.driverDocument.status !== 'NO_DOCUMENT',
    );
  }

  expediteDocumentStatusLabel(row: ExpediteShipment): string {
    const labels = {
      NO_DOCUMENT: 'No Documents',
      READY: 'Documents Ready',
      PRINTING: 'Printing',
      PRINTED: 'Printed to Driver',
      PRINT_FAILED: 'Print Failed',
    } as const;
    return labels[row.driverDocument?.status ?? 'NO_DOCUMENT'];
  }

  beginExpediteDocumentUpload(
    row: ExpediteShipment,
    input: HTMLInputElement,
  ): void {
    if (this.documentUploadingKey || this.expediteDirection(row) === 'UNKNOWN') return;
    this.documentUploadTarget = row;
    input.value = '';
    input.click();
  }

  async uploadExpediteDriverDocument(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    const target = this.documentUploadTarget;
    if (!file || !target || this.documentUploadingKey) return;

    const direction = this.expediteDirection(target);
    if (direction === 'UNKNOWN') {
      this.documentUploadTarget = null;
      this.uploadError = 'Expedite direction must be Inbound or Outbound before a driver document can be uploaded.';
      return;
    }

    if (
      this.hasExpediteDriverDocument(target)
      && !window.confirm(
        `Replace the active driver document for Expedite shipment ${target.shipmentId}? The current version will remain in audit history.`,
      )
    ) {
      this.documentUploadTarget = null;
      return;
    }

    const invalidReason = await pdfUploadValidationError(file, 'Expedite driver documents');
    if (invalidReason) {
      this.documentUploadTarget = null;
      this.uploadError = invalidReason;
      return;
    }

    const uploadKey = this.expediteShipmentKey(target);
    this.documentUploadingKey = uploadKey;
    const idempotencyKey = this.uploadIdempotency.keyFor(uploadKey, file, newUploadIdempotencyKey);

    const form = new FormData();
    form.append('file', file, file.name);
    const url = `/api/v1/rxo-documents/${encodeURIComponent(EXPEDITE_DOCUMENT_SITE_KEY)}/${encodeURIComponent(direction)}/${encodeURIComponent(target.shipmentId)}/browser-upload`;
    this.subs.add(
      this.http.post<Record<string, any>>(url, form, {
        headers: {
          'X-Truck-Log-Upload': 'browser-v1',
          'X-Idempotency-Key': idempotencyKey,
        },
      }).pipe(timeout(50000)).subscribe({
        next: (document) => {
          this.uploadIdempotency.clear();
          this.documentUploadingKey = '';
          this.documentUploadTarget = null;
          this.uploadError = '';
          this.message = `${String(document?.fileName || file.name)} is the active Expedite driver document${document?.version ? ` (version ${document.version})` : ''}.`;
          this.store.refresh();
        },
        error: (response) => {
          this.documentUploadingKey = '';
          this.documentUploadTarget = null;
          this.uploadIdempotency.failed(Number(response?.status ?? 0));
          this.uploadError = response?.error?.message || 'Could not upload the Expedite driver document.';
        },
      }),
    );
  }

  expediteStatusTone(value: string | null, critical: boolean | null): 'success' | 'warning' | 'info' | 'neutral' {
    if (critical === true) return 'warning';
    const status = String(value ?? '').trim().toLowerCase();
    if (!status) return 'neutral';
    if (/risk|late|past due|delayed|exception|watch|possible delay/.test(status)) return 'warning';
    if (/on time|ready|accepted/.test(status)) return 'success';
    if (/transit|moving|departed|arrived/.test(status)) return 'info';
    return 'neutral';
  }

  expediteDocumentTone(row: ExpediteShipment): 'success' | 'info' | 'danger' | 'neutral' {
    const status = row.driverDocument?.status ?? 'NO_DOCUMENT';
    if (status === 'PRINTED') return 'success';
    if (status === 'READY' || status === 'PRINTING') return 'info';
    if (status === 'PRINT_FAILED') return 'danger';
    return 'neutral';
  }

  show(value: string | number | null): string { return value == null || value === '' ? '—' : String(value); }
  private formatAge(ms: number): string { if (!Number.isFinite(ms)) return 'Not received'; const s=Math.max(0,Math.floor(ms/1000)); return s<60 ? `${s}s ago` : s<3600 ? `${Math.floor(s/60)}m ${s%60}s ago` : `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ago`; }
  get expediteHeartbeatAgeMs(): number { const v=this.status?.scheduler?.schedulerHeartbeatAt; return v ? Math.max(0,this.clockNow-Date.parse(v)) : Number.POSITIVE_INFINITY; }
  get expediteApiAgeMs(): number { return this.statusReceivedAt ? Math.max(0,Date.now()-this.statusReceivedAt) : Number.POSITIVE_INFINITY; }
  get expediteHeartbeatAgeLabel(): string { return this.formatAge(this.expediteHeartbeatAgeMs); }
  get expediteApiAgeLabel(): string { return this.formatAge(this.expediteApiAgeMs); }
  get expediteTimerStale(): boolean { return !this.status || this.expediteApiAgeMs>15000 || this.expediteHeartbeatAgeMs>30000; }
  get latestFailureAt(): string | null {
    return expediteFailureTime(this.status?.acquisition.lastError ? this.status.acquisition.completedAt : null, this.status?.scheduler?.lastFailureAt);
  }
  get latestFailureDetail(): string { return expediteFailureDetail(this.status?.acquisition.diagnostic); }
  get expediteNeedsReview(): boolean { return !!(this.status?.acquisition.lastError || this.status?.scheduler?.lastErrorCode); }
  get expediteTimerState(): string { if(this.expediteTimerStale)return 'STATUS STALE'; if(this.status?.scheduler?.state==='EXPORTING')return 'LIVE - RUNNING'; if(this.status?.scheduler?.state==='WAITING' && this.status.scheduler.nextRunAt)return this.expediteNeedsReview ? 'LIVE - WAITING; LAST ATTEMPT FAILED' : 'LIVE - WAITING'; return 'PAUSED'; }
  get expediteDurationLabel(): string { const v=this.status?.scheduler?.lastDurationSeconds; if(!Number.isFinite(v))return '-'; const n=Math.max(0,Number(v)); return n<60 ? `${n.toFixed(1)}s` : `${Math.floor(n/60)}m ${Math.round(n%60)}s`; }
  get expediteBrowserTimeLabel(): string { return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(this.clockNow)); }
  get expediteSchedulerProcessLabel(): string { const state=this.status?.scheduler?.state; return state && !['NOT_STARTED','STOPPED'].includes(state) ? 'ACTIVE' : (state || 'NOT_STARTED'); }
  get expediteExporterProcessLabel(): string { return this.status?.scheduler?.state === 'EXPORTING' ? 'RUNNING' : 'IDLE'; }
  get expediteLastOutputLabel(): string { return this.status?.scheduler?.lastCompletedAt ? this.displayExportTime(this.status.scheduler.lastCompletedAt) : 'Not recorded'; }
  get expediteRecoveryState(): string { return this.expediteNeedsReview ? 'RETAIN LAST GOOD' : 'NONE'; }
  get expediteRecoveryOutcome(): string { return this.expediteNeedsReview ? 'Previous verified batch retained' : 'No recovery needed'; }
  get expediteExporterHealthy(): boolean { return !!this.status && !this.expediteTimerStale && !this.expediteNeedsReview && this.status.acquisition.state==='SUCCESS'; }
  get expediteExporterStatus(): string { if(this.expediteTimerStale)return 'STATUS STALE'; if(this.expediteNeedsReview)return 'REVIEW'; if(this.status?.scheduler?.state==='EXPORTING')return 'RUNNING'; return this.status?.acquisition.state || 'UNKNOWN'; }
  ngOnInit() {
    // Editable fields follow the server only while the operator is not editing them.
    if (this.store.status) this.syncEditableFields(this.store.status);
    this.store.statusUpdates.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => this.syncEditableFields(status));
    if (this.mode === 'health') this.healthClockTimer = window.setInterval(() => this.clockNow = Date.now(), 1000);
  }
  ngOnDestroy() { this.stopped = true; this.replacementPassword = ''; if (this.healthClockTimer !== null) window.clearInterval(this.healthClockTimer); this.subs.unsubscribe(); }
  /** Ask the shared Expedite store for a fresh status and shipment list now. */
  refresh() {
    if (this.stopped) return;
    this.store.refresh();
  }
  private syncEditableFields(s: ExpediteStatus) {
    this.clockNow = Date.now();
    if (!this.dirty && !this.saving) this.username = s.credentials.username;
    if (!this.settingsDirty && !this.settingsSaving) {
      this.settingsInterval = s.settings?.intervalMinutes ?? s.scheduler?.intervalMinutes ?? 30;
      this.settingsSyncOnStart = s.settings?.syncOnStart ?? s.scheduler?.syncOnStart ?? true;
    }
  }
  saveSettings() {
    if (!this.saveAllowed || this.settingsSaving || this.stopped || !this.settingsValid) return;
    const body = { intervalMinutes: Number(this.settingsInterval), syncOnStart: this.settingsSyncOnStart === true };
    this.settingsSaving = true; this.actionError = ''; this.message = '';
    this.subs.add(this.http.put<{source: string; settings: {intervalMinutes: number; syncOnStart: boolean}}>('/api/v1/rxo/expedite/settings', body,
      {headers: {'X-Truck-Log-Expedite-Intent': 'update-settings'}}).pipe(timeout(50000)).subscribe({
        next: value => { if (this.stopped) return; this.settingsSaving = false; if (value?.source !== 'RXO_EXPEDITE' || !value.settings) { this.actionError = 'The Expedite schedule save could not be verified.'; return; } this.settingsInterval = value.settings.intervalMinutes; this.settingsSyncOnStart = value.settings.syncOnStart; this.settingsDirty = false; this.message = 'Expedite scan settings saved. The running scheduler will use the new interval automatically.'; this.refresh(); },
        error: () => { if (this.stopped) return; this.settingsSaving = false; this.actionError = 'Expedite scan settings were not saved. Refresh status before retrying.'; }
      }));
  }
  save() {
    if (!this.saveAllowed || this.saving || this.stopped || !this.username.trim()) return;
    if (!this.status?.credentials.passwordConfigured && !this.replacementPassword) { this.actionError = 'The dedicated Expedite password is required for initial setup.'; return; }
    const body = { username: this.username.trim(), password: this.replacementPassword };
    this.replacementPassword = ''; this.saving = true; this.actionError = ''; this.message = '';
    this.subs.add(this.http.put<{source: string; configured: boolean}>('/api/v1/rxo/expedite/credentials', body,
      {headers: {'X-Truck-Log-Expedite-Intent': 'update-credentials'}}).pipe(timeout(50000)).subscribe({
        next: s => { body.password = ''; if (this.stopped) return; this.saving = false;
          if (s?.source !== 'RXO_EXPEDITE' || s.configured !== true) { this.actionError = 'The Expedite credential save could not be verified.'; return; }
          this.dirty = false; this.message = 'Dedicated Expedite credentials saved. Standard RXO credentials were not changed.'; this.refresh();
        },
        error: () => { body.password = ''; if (this.stopped) return; this.saving = false; this.actionError = 'Expedite credentials were not confirmed. Refresh the status before retrying. No password is returned by this form.'; }
      }));
  }
}
