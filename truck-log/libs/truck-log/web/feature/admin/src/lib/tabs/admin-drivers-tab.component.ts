import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { DriverReferenceRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';
import { AdminDataStore, normalizedText } from '../admin-data.store';
import { RowDrafts, trimmed } from '../row-drafts';

interface DriverDraft { name: string; phoneNumber: string; }

/** Administration > Drivers. */
@Component({
  selector: 'div[tlAdminDriversTab]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="dana-panel tl-fill">
      <div class="dana-panel-header">
        <div><h2>Drivers</h2><small>{{data.drivers.length}} saved driver{{data.drivers.length === 1 ? '' : 's'}}</small></div>
      </div>
      <div class="dana-panel-body tl-stack">
        <p class="dana-page-description">Drivers, carriers and locations are saved separately, so a returning driver can come with a different carrier. Each visit keeps its own copy, so edits here never change old records. A saved phone is optional here; check-in still asks for one on every visit.</p>
        <form class="dana-filter-row" (ngSubmit)="addDriver()">
          <label>Driver name<input name="newDriverName" [(ngModel)]="newDriverName" placeholder="Driver full name"></label>
          <label><span class="dana-field-head"><span>Phone number</span><span class="dana-field-tag">Optional</span></span><input name="newDriverPhone" [(ngModel)]="newDriverPhone" placeholder="Phone number" type="tel"></label>
          <div class="dana-actions tl-filter-actions"><button class="dana-btn dana-btn-primary" type="submit" [disabled]="data.busy || !newDriverName.trim()">Add driver</button></div>
        </form>
        <div class="dana-filter-row">
          <label class="tl-admin-grow">Filter drivers<input type="search" [(ngModel)]="driverFilter" placeholder="Name or phone"></label>
        </div>
      </div>
        <div class="dana-table-shell">
          <table class="dana-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Status</th><th scope="col">Last used</th><th scope="col"><span class="dana-muted">Actions</span></th></tr></thead>
            <tbody>
            <ng-container *ngFor="let driver of filteredDrivers; trackBy: trackById">
            <tr [attr.data-tone]="edits.error(driver) ? 'danger' : (edits.dirty(driver) ? 'warning' : null)">
              <td><input class="dana-input" [attr.aria-label]="'Name for ' + driver.name" [(ngModel)]="edits.draft(driver).name"></td>
              <td><input class="dana-input" [attr.aria-label]="'Phone for ' + driver.name" [(ngModel)]="edits.draft(driver).phoneNumber" type="tel" placeholder="Not saved"></td>
              <td><span class="dana-status-badge" [attr.data-tone]="driver.active ? 'success' : 'neutral'">{{driver.active ? 'Active' : 'Disabled'}}</span><span class="dana-cell-sub" *ngIf="edits.dirty(driver)">Unsaved changes</span></td>
              <td class="dana-nowrap">{{driver.lastUsedAt ? (driver.lastUsedAt | date:'short') : 'Not yet'}}</td>
              <td><div class="dana-table-actions">
                <button class="dana-btn dana-btn-sm dana-btn-primary" type="button" [disabled]="data.busy || !edits.dirty(driver)" (click)="saveDriver(driver)">Save</button>
                <button class="dana-btn dana-btn-sm" type="button" [disabled]="data.busy" (click)="toggleDriver(driver)">{{driver.active ? 'Disable' : 'Enable'}}</button>
              </div></td>
            </tr>
            <tr *ngIf="edits.error(driver)"><td colspan="5"><p class="dana-alert dana-alert-danger" role="alert">{{edits.error(driver)}}</p></td></tr>
            </ng-container>
            </tbody>
          </table>
        </div>
      <div class="dana-empty-state" *ngIf="!filteredDrivers.length">No drivers match this filter.</div>
    </section>`,
})
export class AdminDriversTabComponent {
  newDriverName = '';
  newDriverPhone = '';
  driverFilter = '';
  readonly edits = new RowDrafts<DriverReferenceRecord, DriverDraft>(
    (row) => ({ name: row.name, phoneNumber: row.phoneNumber ?? '' }),
    (row, draft) => trimmed(row.name) === trimmed(draft.name) && trimmed(row.phoneNumber) === trimmed(draft.phoneNumber),
  );

  constructor(readonly data: AdminDataStore, private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  trackById(_index: number, row: DriverReferenceRecord) { return row.id; }

  get filteredDrivers() {
    const q = normalizedText(this.driverFilter);
    return !q ? this.data.drivers : this.data.drivers.filter((driver) =>
      normalizedText(driver.name).includes(q) || normalizedText(driver.phoneNumber).includes(q));
  }

  addDriver() {
    const name = this.newDriverName.trim();
    if (!name || this.data.busy) return;
    this.data.busy = true;
    this.api.createDriver({ name, phoneNumber: this.newDriverPhone.trim() || undefined }).subscribe({
      next: () => {
        this.data.busy = false;
        this.newDriverName = '';
        this.newDriverPhone = '';
        this.toast.success(`${name} added to reusable drivers.`, 'Driver added');
        this.data.loadDrivers();
      },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not add driver.', 'Driver not added'); },
    });
  }

  saveDriver(driver: DriverReferenceRecord) {
    if (this.data.busy) return;
    const draft = this.edits.draft(driver);
    this.data.busy = true;
    this.api.updateDriver(driver.id, {
      name: draft.name.trim(),
      phoneNumber: draft.phoneNumber?.trim() || '',
      active: driver.active,
    }).subscribe({
      next: (saved) => { this.data.busy = false; this.edits.saved(driver); this.data.replaceDriver(saved); this.toast.success('Driver saved.', 'Reference data updated'); },
      error: (e) => { this.data.busy = false; this.edits.failed(driver, e?.error?.message || 'Could not save driver.'); },
    });
  }

  toggleDriver(driver: DriverReferenceRecord) {
    if (this.data.busy) return;
    this.data.busy = true;
    this.api.updateDriver(driver.id, { active: !driver.active }).subscribe({
      next: (saved) => { this.data.busy = false; this.data.replaceDriver(saved); this.toast.success(`Driver ${driver.active ? 'disabled' : 'enabled'}.`, 'Reference data updated'); },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not update driver.', 'Driver not updated'); },
    });
  }
}
