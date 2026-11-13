import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  STATION_NAME_MAX,
  StationKinds,
  type StationKind,
  type StationPairingResult,
  type StationRecord,
} from '@truck-log/shared/contracts';
import { TruckLogAdminAccessComponent, TruckLogAdminAuth } from '@truck-log/web/auth/admin';
import { formatPlantDate } from '@truck-log/web/domain';
import { ToastService, TruckLogDialogDirective, PlantDatePipe } from '@truck-log/web/ui';
import { STATION_SETUP_PATH, TruckLogStationAccess, stationErrorMessage, stationKindLabel } from './station-access.service';

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return 'never';
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function clockTime(iso: string | null | undefined): string {
  return formatPlantDate(iso, 'h:mm a') || '—';
}

/** Admin > Stations: register guard PCs and TVs, issue pairing codes, revoke stations. */
@Component({
  selector: 'tl-stations-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TruckLogAdminAccessComponent, TruckLogDialogDirective, PlantDatePipe],
  template: `
  <tl-admin-access></tl-admin-access>
  <div class="tl-admin">
  <header class="dana-page-header">
    <div>
      <h1>Stations</h1>
      <p>Guard PCs, dock handhelds, management screens and TV displays that may open Truck Log. Each station is paired once with a one-time code.</p>
    </div>
    <div class="dana-actions"><a class="dana-btn" routerLink="/admin">Back to Administration</a></div>
  </header>

  <section class="dana-card" data-tone="success" *ngIf="pairing as result" role="status" aria-labelledby="tl-pairing-title">
    <div class="dana-card-header">
      <div>
        <span class="dana-card-eyebrow" id="tl-pairing-title">Pairing code for {{result.station.name}}</span>
        <strong class="dana-card-title" aria-label="Pairing code">{{result.pairingCode}}</strong>
      </div>
      <span class="dana-status-badge" data-tone="warning">Expires {{clock(result.pairingExpiresAt)}}</span>
    </div>
    <p class="dana-page-description">On the station, open <b>{{setupAddress}}</b> and enter this code. It works once.</p>
    <div class="dana-actions">
      <button type="button" class="dana-btn dana-btn-primary" (click)="copy(result.pairingCode, 'Pairing code')">Copy code</button>
      <button type="button" class="dana-btn" (click)="copy(setupAddress, 'Setup address')">Copy setup address</button>
      <button type="button" class="dana-btn dana-btn-ghost" (click)="pairing = null">Done</button>
    </div>
  </section>

  <section class="dana-panel">
    <div class="dana-panel-header"><div><h2>Add station</h2><small>A new station gets its first pairing code right away.</small></div></div>
    <div class="dana-panel-body">
      <form class="dana-filter-row" (ngSubmit)="create()">
        <label class="tl-admin-grow">Name<input name="stationName" [(ngModel)]="newName" [attr.maxlength]="nameMax" placeholder="Example: East gate guard PC" autocomplete="off" required></label>
        <label>Kind
          <select name="stationKind" [(ngModel)]="newKind">
            <option [ngValue]="kinds.GUARD">Guard station (guard shack PC)</option>
            <option [ngValue]="kinds.DOCK">Dock handheld (CK65: Dock Board and Records)</option>
            <option [ngValue]="kinds.MANAGEMENT">Management (view only)</option>
            <option [ngValue]="kinds.DISPLAY">TV display</option>
          </select>
        </label>
        <div class="dana-actions tl-filter-actions"><button class="dana-btn dana-btn-primary" type="submit" [disabled]="busy || !newName.trim() || !auth.canWrite()">{{creating ? 'Adding…' : 'Add station'}}</button></div>
      </form>
    </div>
  </section>

  <p class="dana-alert dana-alert-danger" role="alert" *ngIf="error">{{error}}</p>

  <section class="dana-panel">
    <div class="dana-panel-header">
      <div><h2>Registered stations</h2><small>{{stations.length}} station{{stations.length === 1 ? '' : 's'}}</small></div>
      <button type="button" class="dana-btn" [disabled]="loading" (click)="load()">{{loading ? 'Loading…' : 'Refresh'}}</button>
    </div>
    <div class="dana-table-shell" *ngIf="stations.length">
      <table class="dana-table">
        <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col"><span class="dana-muted">Actions</span></th></tr></thead>
        <tbody>
          <tr *ngFor="let station of stations; trackBy: trackById">
            <td><b>{{station.name}}</b><span class="dana-cell-sub">Added {{station.createdAt | plantDate:'M/d/yy h:mm a'}}{{station.createdBy ? ' by ' + station.createdBy : ''}}</span></td>
            <td><span class="dana-status-badge is-plain" [attr.data-tone]="station.kind === kinds.GUARD ? 'neutral' : 'info'">{{kindLabel(station.kind)}}</span></td>
            <td><span class="dana-status-badge" [attr.data-tone]="station.status === 'ACTIVE' ? 'success' : (station.status === 'REVOKED' ? 'danger' : 'warning')">{{statusLabel(station)}}</span></td>
            <td>
              <div class="dana-table-actions">
                <button type="button" class="dana-btn dana-btn-sm" [disabled]="busy || !auth.canWrite() || station.status === 'REVOKED'" (click)="beginEdit(station)">Edit</button>
                <button type="button" class="dana-btn dana-btn-sm" [disabled]="busy || !auth.canWrite()" (click)="newCode(station)">New pairing code</button>
                <button type="button" class="dana-btn dana-btn-sm dana-btn-warning" [disabled]="busy || !auth.canWrite() || station.status === 'REVOKED'" (click)="revokeTarget = station">Revoke</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="dana-empty-state" *ngIf="!stations.length && !loading && loaded">No stations yet. Add the first guard PC, dock handheld or TV above.</div>
  </section>
  </div>

  <div class="dana-dialog-backdrop" *ngIf="editTarget as target" (click)="cancelEdit()">
    <form class="dana-dialog" tlDialog="tl-edit-station-title" [tlDialogEscape]="!busy" (tlDialogClose)="cancelEdit()" (click)="$event.stopPropagation()" (ngSubmit)="saveEdit(target)" autocomplete="off">
      <div class="dana-dialog-header"><h2 id="tl-edit-station-title">Edit {{target.name}}</h2>
      <p>The station stays paired and signed in; you don't need a new pairing code.</p></div>
      <div class="dana-dialog-body tl-stack">
        <label class="dana-field">Name
          <input class="dana-input" name="editStationName" [(ngModel)]="editName" [attr.maxlength]="nameMax" required autofocus>
        </label>
        <label class="dana-field">Kind
          <select class="dana-input" name="editStationKind" [(ngModel)]="editKind">
            <option [ngValue]="kinds.GUARD">Guard station (guard shack PC)</option>
            <option [ngValue]="kinds.DOCK">Dock handheld (CK65: Dock Board and Records)</option>
            <option [ngValue]="kinds.MANAGEMENT">Management (view only)</option>
            <option [ngValue]="kinds.DISPLAY">TV display</option>
          </select>
        </label>
        <p class="dana-field-hint" *ngIf="editKind !== target.kind">What this station may do changes right away. Its screens change the next time it loads Truck Log (reload the page on that device).</p>
        <p class="dana-field-error" role="alert" *ngIf="editError">{{editError}}</p>
      </div>
      <div class="dana-dialog-actions">
        <button type="button" class="dana-btn" [disabled]="busy" (click)="cancelEdit()">Cancel</button>
        <button type="submit" class="dana-btn dana-btn-primary" [disabled]="busy || !editName.trim() || !editChanged(target)">{{busy ? 'Saving…' : 'Save'}}</button>
      </div>
    </form>
  </div>

  <div class="dana-dialog-backdrop" *ngIf="revokeTarget as target" (click)="revokeTarget = null">
    <section class="dana-dialog" tlDialog="tl-revoke-title" tlDialogRole="alertdialog" [tlDialogEscape]="!busy" (tlDialogClose)="revokeTarget = null" (click)="$event.stopPropagation()">
      <div class="dana-dialog-header"><h2 id="tl-revoke-title">Revoke {{target.name}}?</h2>
      <p>This {{kindLabel(target.kind).toLowerCase()}} is signed out immediately and can't open Truck Log until an administrator issues a new pairing code.</p></div>
      <div class="dana-dialog-actions">
        <button type="button" class="dana-btn" [disabled]="busy" (click)="revokeTarget = null">Cancel</button>
        <button type="button" class="dana-btn dana-btn-danger" [disabled]="busy" (click)="revoke(target)">{{busy ? 'Revoking…' : 'Revoke station'}}</button>
      </div>
    </section>
  </div>`,
})
export class StationsAdminComponent implements OnInit, OnDestroy {
  readonly auth = inject(TruckLogAdminAuth);
  private readonly access = inject(TruckLogStationAccess);
  private readonly toast = inject(ToastService);

  readonly kinds = StationKinds;
  readonly nameMax = STATION_NAME_MAX;
  stations: StationRecord[] = [];
  newName = '';
  newKind: StationKind = StationKinds.GUARD;
  pairing: StationPairingResult | null = null;
  revokeTarget: StationRecord | null = null;
  editTarget: StationRecord | null = null;
  editName = '';
  editKind: StationKind = StationKinds.GUARD;
  editError = '';
  busy = false;
  creating = false;
  loading = false;
  error = '';
  /** Re-render relative "last seen" text once a minute. */
  now = Date.now();
  private clockTimer?: number;

  get setupAddress() {
    return (typeof location !== 'undefined' ? location.origin : '') + STATION_SETUP_PATH;
  }

  ngOnInit() {
    this.load();
    this.clockTimer = window.setInterval(() => { this.now = Date.now(); }, 60000);
  }

  ngOnDestroy() {
    if (this.clockTimer) window.clearInterval(this.clockTimer);
  }

  trackById(_index: number, station: StationRecord) { return station.id; }
  kindLabel(kind: string) { return stationKindLabel(kind); }
  clock(iso: string | null) { return clockTime(iso); }

  statusLabel(station: StationRecord): string {
    if (station.status === 'REVOKED') return 'Revoked';
    if (station.status === 'ACTIVE') return `Active (last seen ${relativeTime(station.lastSeenAt, this.now)})`;
    const expires = station.pairingExpiresAt ? Date.parse(station.pairingExpiresAt) : NaN;
    if (Number.isFinite(expires) && expires <= this.now) return 'Waiting for pairing (code expired)';
    return `Waiting for pairing (code expires ${clockTime(station.pairingExpiresAt)})`;
  }

  /** The list has been read at least once: "No stations yet" is never shown for a failed load. */
  loaded = false;

  load() {
    if (this.loading) return;
    this.loading = true;
    this.access.stations().subscribe({
      next: (rows) => { this.stations = rows; this.loading = false; this.loaded = true; this.error = ''; this.now = Date.now(); },
      error: (e) => { this.loading = false; this.error = stationErrorMessage(e, 'Could not load stations.'); },
    });
  }

  create() {
    const name = this.newName.trim();
    if (this.busy || !name || !this.auth.canWrite()) return;
    this.busy = true; this.creating = true; this.error = '';
    this.access.createStation(name, this.newKind).subscribe({
      next: (result) => {
        this.busy = false; this.creating = false;
        this.newName = '';
        this.showPairing(result);
        this.toast.success(`${result.station.name} added. Give the pairing code to the station.`, 'Station added');
      },
      error: (e) => { this.busy = false; this.creating = false; this.error = stationErrorMessage(e, 'The station was not added.'); },
    });
  }

  newCode(station: StationRecord) {
    if (this.busy || !this.auth.canWrite()) return;
    if (station.status === 'ACTIVE' && !window.confirm(`Issue a new pairing code for ${station.name}? It will be signed out until the new code is entered.`)) return;
    this.busy = true; this.error = '';
    this.access.newPairingCode(station.id).subscribe({
      next: (result) => { this.busy = false; this.showPairing(result); },
      error: (e) => { this.busy = false; this.error = stationErrorMessage(e, 'A new pairing code was not issued.'); },
    });
  }

  beginEdit(station: StationRecord) {
    if (this.busy || !this.auth.canWrite() || station.status === 'REVOKED') return;
    this.editTarget = station;
    this.editName = station.name;
    this.editKind = station.kind;
    this.editError = '';
  }

  cancelEdit() {
    if (this.busy) return;
    this.editTarget = null;
    this.editError = '';
  }

  editChanged(station: StationRecord): boolean {
    return this.editName.trim() !== station.name || this.editKind !== station.kind;
  }

  saveEdit(station: StationRecord) {
    const name = this.editName.trim();
    if (this.busy || !this.auth.canWrite() || !name || !this.editChanged(station)) return;
    const changes: { name?: string; kind?: StationKind } = {};
    if (name !== station.name) changes.name = name;
    if (this.editKind !== station.kind) changes.kind = this.editKind;
    this.busy = true; this.editError = '';
    this.access.updateStation(station.id, changes).subscribe({
      next: (updated) => {
        this.busy = false; this.editTarget = null;
        this.upsert(updated);
        if (this.pairing?.station.id === updated.id) this.pairing = { ...this.pairing, station: updated };
        const parts = [
          changes.name ? `renamed to ${updated.name}` : '',
          changes.kind ? `now a ${this.kindLabel(updated.kind).toLowerCase()}` : '',
        ].filter(Boolean).join(' and ');
        this.toast.success(`${station.name} ${parts}.`, 'Station updated');
      },
      error: (e) => { this.busy = false; this.editError = stationErrorMessage(e, 'The station was not changed.'); },
    });
  }

  revoke(station: StationRecord) {
    if (this.busy || !this.auth.canWrite()) return;
    this.busy = true; this.error = '';
    this.access.revoke(station.id).subscribe({
      next: (updated) => {
        this.busy = false; this.revokeTarget = null;
        this.upsert(updated);
        if (this.pairing?.station.id === updated.id) this.pairing = null;
        this.toast.success(`${updated.name} was revoked.`, 'Station revoked');
      },
      error: (e) => { this.busy = false; this.revokeTarget = null; this.error = stationErrorMessage(e, 'The station was not revoked.'); },
    });
  }

  copy(text: string, label: string) {
    const done = () => this.toast.success(`${label} copied.`, 'Copied', 2500);
    const fail = () => this.toast.warning(`Select the ${label.toLowerCase()} and copy it manually.`, 'Copy unavailable');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fail);
    else fail();
  }

  private showPairing(result: StationPairingResult) {
    this.pairing = result;
    this.upsert(result.station);
  }

  private upsert(station: StationRecord) {
    const index = this.stations.findIndex((row) => row.id === station.id);
    this.stations = index < 0 ? [...this.stations, station] : this.stations.map((row) => row.id === station.id ? station : row);
    this.now = Date.now();
  }
}
