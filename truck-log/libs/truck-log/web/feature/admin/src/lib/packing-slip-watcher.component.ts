import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  PACKING_SLIP_ROUTE_MODES,
  PACKING_SLIP_ROUTE_NAME_MAX,
  PACKING_SLIP_ROUTE_PRINTER_MAX,
  PACKING_SLIP_ROUTE_QUEUE_MAX,
  newlyLivePackingSlipRoutes,
  packingSlipRouteChanges,
  validatePackingSlipRoutes,
  type PackingSlipRoute,
  type PackingSlipRouteConfig,
  type PackingSlipRouteField,
  type PackingSlipRouteIssue,
  type PackingSlipRouteMode,
} from '@truck-log/shared/contracts';
import { TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import { TruckLogApi } from '@truck-log/web/data-access';
import { TruckLogDialogDirective } from '@truck-log/web/ui';

const MODE_LABELS: Record<PackingSlipRouteMode, string> = { OFF: 'Off', TEST: 'Test', LIVE: 'Live' };
const MODE_TONES: Record<PackingSlipRouteMode, string> = { OFF: 'neutral', TEST: 'info', LIVE: 'success' };

/**
 * Administration > Printing > Packing slip watcher: the eight SAP capture queue
 * routes the watcher on the print PC reads from Truck Log. Switching a route to
 * Live (paper printing) needs a confirmation that names the printers.
 */
@Component({
  selector: 'tl-packing-slip-watcher',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TruckLogDialogDirective],
  template: `
  <section class="dana-panel" data-truck-log-printing="packing-slip-watcher">
    <div class="dana-panel-header">
      <div><h2>Packing slip watcher</h2><small>SAP capture queue routes on the print PC</small></div>
      <div class="dana-actions" *ngIf="saved">
        <span class="dana-status-badge is-plain" data-tone="neutral">Version {{saved.version}}</span>
        <span class="dana-status-badge" data-tone="warning" *ngIf="dirty">Unsaved changes</span>
      </div>
    </div>
    <div class="dana-panel-body tl-stack">
      <p class="dana-page-description">The watcher reads these routes from Truck Log about once a minute and applies a change between captures. <b>Off</b> ignores the route. <b>Test</b> checks and files each packing slip, and uploads it when Upload is on, but never prints. <b>Live</b> also prints verified slips on the output printer.</p>
      <p class="dana-field-hint" *ngIf="saved">Last changed by <b>{{saved.updatedBy}}</b> at {{saved.updatedAt | date:'M/d/yy h:mm a'}}</p>
      <p class="dana-loading-state" *ngIf="loading" role="status">Loading watcher routes…</p>
      <div class="dana-alert dana-alert-danger tl-admin-retry" *ngIf="loadError" role="alert">
        <span>{{loadError}}</span>
        <button type="button" class="dana-btn dana-btn-sm" [disabled]="loading || saving" (click)="load()">Retry</button>
      </div>
      <p class="dana-alert dana-alert-warning" *ngIf="conflictMessage" role="alert">{{conflictMessage}}</p>
      <div class="dana-alert dana-alert-warning tl-admin-retry" *ngIf="saved && !auth.canWrite()" role="note">
        <span>Read-only. Sign in as administrator to change watcher routes.</span>
        <a class="dana-btn dana-btn-sm" routerLink="/admin/login" [queryParams]="{ returnTo: '/admin' }">Sign in as administrator</a>
      </div>
    </div>

    <div class="dana-table-shell" *ngIf="saved">
      <table class="dana-table tl-watcher-table">
        <thead><tr><th scope="col">Route #</th><th scope="col">Name</th><th scope="col">SAP capture queue</th><th scope="col">Output printer</th><th scope="col">Mode</th><th scope="col">Upload to Truck Log</th></tr></thead>
        <tbody *ngIf="auth.canWrite(); else readOnlyRows">
          <tr *ngFor="let row of drafts; trackBy: trackByRoute" [attr.data-tone]="rowIssues(row.route).length ? 'danger' : (rowDirty(row.route) ? 'warning' : null)">
            <th scope="row">{{row.route}}</th>
            <td>
              <input class="dana-input" type="text" [attr.maxlength]="nameMax" autocomplete="off" [attr.aria-label]="'Name for route ' + row.route" [(ngModel)]="row.name" (ngModelChange)="edited()" [disabled]="saving">
              <span class="dana-field-error" *ngIf="issue(row.route, 'name') as message">{{message}}</span>
            </td>
            <td class="tl-watcher-wide">
              <input class="dana-input" type="text" [attr.maxlength]="queueMax" autocomplete="off" spellcheck="false" [attr.aria-label]="'SAP capture queue for route ' + row.route" [(ngModel)]="row.sourceQueue" (ngModelChange)="edited()" [disabled]="saving">
              <span class="dana-field-error" *ngIf="issue(row.route, 'sourceQueue') as message">{{message}}</span>
            </td>
            <td class="tl-watcher-printer">
              <input class="dana-input" type="text" [attr.title]="row.outputPrinter" [attr.maxlength]="printerMax" autocomplete="off" spellcheck="false" placeholder="\\\\SERVER\\Printer" [attr.aria-label]="'Output printer for route ' + row.route" [(ngModel)]="row.outputPrinter" (ngModelChange)="edited()" [disabled]="saving">
              <span class="dana-field-error" *ngIf="issue(row.route, 'outputPrinter') as message">{{message}}</span>
            </td>
            <td>
              <select class="dana-select" [attr.aria-label]="'Mode for route ' + row.route" [(ngModel)]="row.mode" (ngModelChange)="edited()" [disabled]="saving">
                <option *ngFor="let mode of modes" [ngValue]="mode">{{modeLabel(mode)}}</option>
              </select>
              <span class="dana-field-error" *ngIf="issue(row.route, 'mode') as message">{{message}}</span>
            </td>
            <td>
              <label class="dana-check"><input type="checkbox" [(ngModel)]="row.uploadEnabled" (ngModelChange)="edited()" [disabled]="saving"><span>Upload</span></label>
            </td>
          </tr>
        </tbody>
        <ng-template #readOnlyRows>
          <tbody>
            <tr *ngFor="let row of saved.routes; trackBy: trackByRoute">
              <th scope="row">{{row.route}}</th>
              <td>{{row.name}}</td>
              <td>{{row.sourceQueue}}</td>
              <td>{{row.outputPrinter || '—'}}</td>
              <td><span class="dana-status-badge" [attr.data-tone]="modeTone(row.mode)">{{modeLabel(row.mode)}}</span></td>
              <td>{{row.uploadEnabled ? 'On' : 'Off'}}</td>
            </tr>
          </tbody>
        </ng-template>
      </table>
    </div>

    <div class="dana-panel-body tl-stack" *ngIf="saved && auth.canWrite()">
      <p class="dana-alert dana-alert-danger" *ngIf="documentIssue" role="alert">{{documentIssue}}</p>
      <p class="dana-alert dana-alert-danger" *ngIf="saveError" role="alert">{{saveError}}</p>
      <p class="dana-alert dana-alert-success" *ngIf="saveMessage" role="status">{{saveMessage}}</p>
      <p class="dana-field-hint">A SAP capture queue can feed only one route that is not Off. A Live route needs an output printer. Switching a route to Live asks for confirmation.</p>
      <div class="dana-actions">
        <button class="dana-btn dana-btn-primary" type="button" [disabled]="!canSave" (click)="save()">{{saving ? 'Saving…' : 'Save'}}</button>
        <button class="dana-btn" type="button" [disabled]="loading || saving" (click)="load()">{{dirty ? 'Discard and reload' : 'Reload'}}</button>
      </div>
    </div>
  </section>

  <div class="dana-dialog-backdrop" *ngIf="liveConfirm.length" (click)="cancelLive()">
    <section class="dana-dialog" tlDialog="tl-watcher-live-title" tlDialogRole="alertdialog" [tlDialogEscape]="!saving" (tlDialogClose)="cancelLive()" (click)="$event.stopPropagation()">
      <div class="dana-dialog-header">
        <h2 id="tl-watcher-live-title">Start printing paper?</h2>
        <p>After you save, the watcher prints every verified packing slip from {{liveConfirm.length === 1 ? 'this route' : 'these routes'}} on paper. Unverified slips are never printed.</p>
      </div>
      <div class="dana-dialog-body">
        <ul class="tl-stack">
          <li *ngFor="let row of liveConfirm"><b>Route {{row.route}} — {{row.name}}</b><span class="dana-cell-sub">{{row.outputPrinter}}</span></li>
        </ul>
      </div>
      <div class="dana-dialog-actions">
        <button type="button" class="dana-btn" [disabled]="saving" (click)="cancelLive()">Cancel</button>
        <button type="button" class="dana-btn dana-btn-warning" [disabled]="saving" (click)="confirmLive()">{{saving ? 'Saving…' : 'Switch to Live and save'}}</button>
      </div>
    </section>
  </div>`,
})
export class PackingSlipWatcherComponent implements OnInit, OnDestroy {
  readonly auth = inject(TruckLogAdminAuth);
  private readonly api = inject(TruckLogApi);

  readonly modes = PACKING_SLIP_ROUTE_MODES;
  readonly nameMax = PACKING_SLIP_ROUTE_NAME_MAX;
  readonly queueMax = PACKING_SLIP_ROUTE_QUEUE_MAX;
  readonly printerMax = PACKING_SLIP_ROUTE_PRINTER_MAX;

  saved: PackingSlipRouteConfig | null = null;
  drafts: PackingSlipRoute[] = [];
  issues: PackingSlipRouteIssue[] = [];
  liveConfirm: PackingSlipRoute[] = [];
  dirty = false;
  loading = false;
  saving = false;
  loadError = '';
  saveError = '';
  saveMessage = '';
  conflictMessage = '';
  private changedRoutes = new Set<number>();
  private validated: PackingSlipRoute[] = [];
  private readonly subscriptions = new Subscription();
  private requestNumber = 0;
  private destroyed = false;

  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.requestNumber++;
    this.subscriptions.unsubscribe();
  }

  get canSave(): boolean {
    return !!this.saved && this.auth.canWrite() && this.dirty && !this.issues.length && !this.loading && !this.saving && !this.destroyed;
  }
  get documentIssue(): string { return this.issues.find((i) => !i.route)?.message ?? ''; }

  trackByRoute(_index: number, row: PackingSlipRoute) { return row.route; }
  modeLabel(mode: PackingSlipRouteMode): string { return MODE_LABELS[mode] ?? mode; }
  modeTone(mode: PackingSlipRouteMode): string { return MODE_TONES[mode] ?? 'neutral'; }
  rowIssues(route: number): PackingSlipRouteIssue[] { return this.issues.filter((i) => i.route === route); }
  rowDirty(route: number): boolean { return this.changedRoutes.has(route); }
  issue(route: number, field: PackingSlipRouteField): string {
    return this.issues.find((i) => i.route === route && i.field === field)?.message ?? '';
  }

  /** Load the saved routes; any unsaved edits are discarded. */
  load(): void {
    if (this.destroyed || this.saving) return;
    const request = ++this.requestNumber;
    this.loading = true;
    this.loadError = '';
    this.saveError = '';
    this.subscriptions.add(this.api.packingSlipRoutes().subscribe({
      next: (config) => {
        if (this.destroyed || request !== this.requestNumber) return;
        this.loading = false;
        if (!this.adopt(config)) this.loadError = 'Truck Log returned invalid watcher routes. Nothing has been changed.';
      },
      error: (e: HttpErrorResponse) => {
        if (this.destroyed || request !== this.requestNumber) return;
        this.loading = false;
        this.loadError = e?.error?.message || 'Could not load the packing slip watcher routes. Check that the Truck Log server is running, then retry.';
      },
    }));
  }

  edited(): void {
    this.saveMessage = '';
    this.saveError = '';
    this.conflictMessage = '';
    this.validate();
  }

  save(): void {
    if (!this.canSave || !this.saved) return;
    const newlyLive = newlyLivePackingSlipRoutes(this.saved.routes, this.validated);
    if (newlyLive.length) {
      this.liveConfirm = this.validated.filter((r) => newlyLive.includes(r.route));
      return;
    }
    this.submit([]);
  }
  confirmLive(): void {
    if (this.saving || !this.liveConfirm.length) return;
    this.submit(this.liveConfirm.map((r) => r.route));
  }
  cancelLive(): void { if (!this.saving) this.liveConfirm = []; }

  private submit(confirmLive: number[]): void {
    if (!this.saved) return;
    const request = ++this.requestNumber;
    this.saving = true;
    this.saveError = '';
    this.saveMessage = '';
    this.conflictMessage = '';
    this.subscriptions.add(this.api.updatePackingSlipRoutes({ version: this.saved.version, routes: this.validated, confirmLive }).subscribe({
      next: (config) => {
        if (this.destroyed || request !== this.requestNumber) return;
        this.saving = false;
        this.liveConfirm = [];
        if (!this.adopt(config)) { this.saveError = 'The save could not be confirmed. Reload to check the saved routes.'; return; }
        this.saveMessage = `Saved as version ${config.version}. The watcher picks it up within about a minute.`;
      },
      error: (e: HttpErrorResponse) => {
        if (this.destroyed || request !== this.requestNumber) return;
        this.saving = false;
        this.liveConfirm = [];
        if (e?.status === 409) {
          this.conflictMessage = `${e.error?.message || 'Someone else saved the watcher routes while you were editing.'} Your changes were not saved; the latest routes are shown.`;
          this.load();
          return;
        }
        this.saveError = e?.error?.message || 'The save could not be confirmed. Your edits are kept; reload to check the saved routes before retrying.';
      },
    }));
  }

  private adopt(config: PackingSlipRouteConfig): boolean {
    if (!config || typeof config.version !== 'number' || validatePackingSlipRoutes(config.routes).issues.length) return false;
    this.saved = config;
    this.drafts = config.routes.map((r) => ({ ...r }));
    this.validate();
    return true;
  }

  private validate(): void {
    const result = validatePackingSlipRoutes(this.drafts);
    this.issues = result.issues;
    this.validated = result.routes;
    const changes = this.saved ? packingSlipRouteChanges(this.saved.routes, result.routes) : [];
    this.changedRoutes = new Set(changes.map((c) => c.route));
    this.dirty = changes.length > 0;
  }
}

