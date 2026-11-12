import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { LocationReferenceRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService, PlantDatePipe } from '@truck-log/web/ui';
import { AdminDataStore, normalizedText } from '../admin-data.store';
import { RowDrafts, trimmed } from '../row-drafts';

interface LocationDraft { name: string; addressLine1: string; city: string; state: string; postalCode: string; country: string; }
const LOCATION_FIELDS = ['name', 'addressLine1', 'city', 'state', 'postalCode', 'country'] as const;

function emptyLocation(): LocationDraft {
  return { name: '', addressLine1: '', city: '', state: '', postalCode: '', country: '' };
}

/** Administration > Locations. */
@Component({
  selector: 'div[tlAdminLocationsTab]',
  standalone: true,
  imports: [CommonModule, FormsModule, PlantDatePipe],
  template: `
    <section class="dana-panel tl-fill">
      <div class="dana-panel-header">
        <div><h2>Locations</h2><small>{{data.locations.length}} saved — used for origin and destination</small></div>
      </div>
      <div class="dana-panel-body tl-stack">
        <p class="dana-page-description">Customer, supplier, warehouse and plant locations. Editing one never changes past visits.</p>
        <form class="dana-form-grid dana-form-grid-3" (ngSubmit)="addLocation()">
          <label>Location name<input name="newLocation_name" [(ngModel)]="newLocation.name" placeholder="Customer, supplier, warehouse, plant"></label>
          <label><span class="dana-field-head"><span>Street address</span><span class="dana-field-tag">Optional</span></span><input name="newLocation_addressLine1" [(ngModel)]="newLocation.addressLine1" placeholder="Street address"></label>
          <label><span class="dana-field-head"><span>City</span><span class="dana-field-tag">Optional</span></span><input name="newLocation_city" [(ngModel)]="newLocation.city" placeholder="City"></label>
          <label><span class="dana-field-head"><span>State</span><span class="dana-field-tag">Optional</span></span><input name="newLocation_state" [(ngModel)]="newLocation.state" placeholder="State"></label>
          <label><span class="dana-field-head"><span>ZIP / postal</span><span class="dana-field-tag">Optional</span></span><input name="newLocation_postalCode" [(ngModel)]="newLocation.postalCode" placeholder="ZIP / postal"></label>
          <label><span class="dana-field-head"><span>Country</span><span class="dana-field-tag">Optional</span></span><input name="newLocation_country" [(ngModel)]="newLocation.country" placeholder="Country"></label>
          <div class="dana-actions tl-filter-actions"><button class="dana-btn dana-btn-primary" type="submit" [disabled]="data.busy || !newLocation.name.trim()">Add location</button></div>
        </form>
        <div class="dana-filter-row">
          <label class="tl-admin-grow">Filter locations<input type="search" [(ngModel)]="locationFilter" placeholder="Name, city, state, address"></label>
        </div>
      </div>
        <div class="dana-table-shell" *ngIf="filteredLocations.length">
          <table class="dana-table tl-ref-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Street address</th><th scope="col">City</th><th scope="col">State</th><th scope="col">ZIP / postal</th><th scope="col">Country</th><th scope="col">Status</th><th scope="col">Last used</th><th scope="col"><span class="dana-muted">Actions</span></th></tr></thead>
            <tbody>
            <ng-container *ngFor="let location of filteredLocations; trackBy: trackById">
            <tr [attr.data-tone]="edits.error(location) ? 'danger' : (edits.dirty(location) ? 'warning' : null)">
              <td class="tl-ref-wide"><input class="dana-input" [attr.aria-label]="'Name for ' + location.name" [(ngModel)]="edits.draft(location).name"></td>
              <td class="tl-ref-wide"><input class="dana-input" [attr.aria-label]="'Street address for ' + location.name" [(ngModel)]="edits.draft(location).addressLine1" placeholder="Optional"></td>
              <td><input class="dana-input" [attr.aria-label]="'City for ' + location.name" [(ngModel)]="edits.draft(location).city" placeholder="Optional"></td>
              <td><input class="dana-input" [attr.aria-label]="'State for ' + location.name" [(ngModel)]="edits.draft(location).state" placeholder="Optional"></td>
              <td><input class="dana-input" [attr.aria-label]="'ZIP / postal for ' + location.name" [(ngModel)]="edits.draft(location).postalCode" placeholder="Optional"></td>
              <td><input class="dana-input" [attr.aria-label]="'Country for ' + location.name" [(ngModel)]="edits.draft(location).country" placeholder="Optional"></td>
              <td><span class="dana-status-badge" [attr.data-tone]="location.active ? 'success' : 'neutral'">{{location.active ? 'Active' : 'Disabled'}}</span><span class="dana-cell-sub" *ngIf="edits.dirty(location)">Unsaved changes</span></td>
              <td class="dana-nowrap">{{location.lastUsedAt ? (location.lastUsedAt | plantDate:'short') : 'Not yet'}}</td>
              <td><div class="dana-table-actions">
                <button class="dana-btn dana-btn-sm dana-btn-primary" type="button" [disabled]="data.busy || !edits.dirty(location)" (click)="saveLocation(location)">Save</button>
                <button class="dana-btn dana-btn-sm" type="button" [disabled]="data.busy" (click)="toggleLocation(location)">{{location.active ? 'Disable' : 'Enable'}}</button>
              </div></td>
            </tr>
            <tr *ngIf="edits.error(location)"><td colspan="9"><p class="dana-alert dana-alert-danger" role="alert">{{edits.error(location)}}</p></td></tr>
            </ng-container>
            </tbody>
          </table>
        </div>
      <div class="dana-empty-state" *ngIf="!filteredLocations.length" role="status">{{data.emptyText('locations', 'locations', locationFilter)}}</div>
    </section>`,
})
export class AdminLocationsTabComponent {
  newLocation = emptyLocation();
  locationFilter = '';
  readonly edits = new RowDrafts<LocationReferenceRecord, LocationDraft>(
    (row) => ({ name: row.name, addressLine1: row.addressLine1 ?? '', city: row.city ?? '', state: row.state ?? '', postalCode: row.postalCode ?? '', country: row.country ?? '' }),
    (row, draft) => LOCATION_FIELDS.every((field) => trimmed(row[field]) === trimmed(draft[field])),
  );

  constructor(readonly data: AdminDataStore, private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  trackById(_index: number, row: LocationReferenceRecord) { return row.id; }

  get filteredLocations() {
    const q = normalizedText(this.locationFilter);
    if (!q) return this.data.locations;
    return this.data.locations.filter((location) => [
      location.name, location.addressLine1, location.city, location.state, location.postalCode, location.country,
    ].some((value) => normalizedText(value).includes(q)));
  }

  addLocation() {
    const name = this.newLocation.name.trim();
    if (!name || this.data.busy) return;
    this.data.busy = true;
    this.api.createLocation({
      name,
      addressLine1: this.newLocation.addressLine1.trim() || undefined,
      city: this.newLocation.city.trim() || undefined,
      state: this.newLocation.state.trim() || undefined,
      postalCode: this.newLocation.postalCode.trim() || undefined,
      country: this.newLocation.country.trim() || undefined,
    }).subscribe({
      next: () => {
        this.data.busy = false;
        this.newLocation = emptyLocation();
        this.toast.success(`${name} added to reusable locations.`, 'Location added');
        this.data.loadLocations();
      },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not add location.', 'Location not added'); },
    });
  }

  saveLocation(location: LocationReferenceRecord) {
    if (this.data.busy) return;
    const draft = this.edits.draft(location);
    this.data.busy = true;
    this.api.updateLocation(location.id, {
      name: draft.name.trim(),
      addressLine1: draft.addressLine1?.trim() || '',
      city: draft.city?.trim() || '',
      state: draft.state?.trim() || '',
      postalCode: draft.postalCode?.trim() || '',
      country: draft.country?.trim() || '',
      active: location.active,
    }).subscribe({
      next: (saved) => { this.data.busy = false; this.edits.saved(location); this.data.replaceLocation(saved); this.toast.success('Location saved.', 'Reference data updated'); },
      error: (e) => { this.data.busy = false; this.edits.failed(location, e?.error?.message || 'Could not save location.'); },
    });
  }

  toggleLocation(location: LocationReferenceRecord) {
    if (this.data.busy) return;
    this.data.busy = true;
    this.api.updateLocation(location.id, { active: !location.active }).subscribe({
      next: (saved) => { this.data.busy = false; this.data.replaceLocation(saved); this.toast.success(`Location ${location.active ? 'disabled' : 'enabled'}.`, 'Reference data updated'); },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not update location.', 'Location not updated'); },
    });
  }
}
