import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { CarrierReferenceRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';
import { AdminDataStore, normalizedText } from '../admin-data.store';
import { RowDrafts, trimmed } from '../row-drafts';

interface CarrierDraft { name: string; }

/** Administration > Carriers. */
@Component({
  selector: 'div[tlAdminCarriersTab]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="dana-panel">
      <div class="dana-panel-header">
        <div><h2>Carriers</h2><small>{{data.carriers.length}} saved carrier{{data.carriers.length === 1 ? '' : 's'}}</small></div>
      </div>
      <div class="dana-panel-body tl-stack">
        <p class="dana-page-description">Carriers are separate from drivers, so the same driver can come back with a different carrier.</p>
        <form class="dana-filter-row" (ngSubmit)="addCarrier()">
          <label>Carrier name<input name="newCarrierName" [(ngModel)]="newCarrierName" placeholder="Trucking company"></label>
          <div class="dana-actions tl-filter-actions"><button class="dana-btn dana-btn-primary" type="submit" [disabled]="data.busy || !newCarrierName.trim()">Add carrier</button></div>
        </form>
        <div class="dana-filter-row">
          <label class="tl-admin-grow">Filter carriers<input type="search" [(ngModel)]="carrierFilter" placeholder="Carrier name"></label>
        </div>
      </div>
        <div class="dana-table-shell">
          <table class="dana-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Last used</th><th scope="col"><span class="dana-muted">Actions</span></th></tr></thead>
            <tbody>
            <ng-container *ngFor="let carrier of filteredCarriers; trackBy: trackById">
            <tr [attr.data-tone]="edits.error(carrier) ? 'danger' : (edits.dirty(carrier) ? 'warning' : null)">
              <td><input class="dana-input" [attr.aria-label]="'Name for ' + carrier.name" [(ngModel)]="edits.draft(carrier).name"></td>
              <td><span class="dana-status-badge" [attr.data-tone]="carrier.active ? 'success' : 'neutral'">{{carrier.active ? 'Active' : 'Disabled'}}</span><span class="dana-cell-sub" *ngIf="edits.dirty(carrier)">Unsaved changes</span></td>
              <td class="dana-nowrap">{{carrier.lastUsedAt ? (carrier.lastUsedAt | date:'short') : 'Not yet'}}</td>
              <td><div class="dana-table-actions">
                <button class="dana-btn dana-btn-sm dana-btn-primary" type="button" [disabled]="data.busy || !edits.dirty(carrier)" (click)="saveCarrier(carrier)">Save</button>
                <button class="dana-btn dana-btn-sm" type="button" [disabled]="data.busy" (click)="toggleCarrier(carrier)">{{carrier.active ? 'Disable' : 'Enable'}}</button>
              </div></td>
            </tr>
            <tr *ngIf="edits.error(carrier)"><td colspan="4"><p class="dana-alert dana-alert-danger" role="alert">{{edits.error(carrier)}}</p></td></tr>
            </ng-container>
            </tbody>
          </table>
        </div>
      <div class="dana-empty-state" *ngIf="!filteredCarriers.length">No carriers match this filter.</div>
    </section>`,
})
export class AdminCarriersTabComponent {
  newCarrierName = '';
  carrierFilter = '';
  readonly edits = new RowDrafts<CarrierReferenceRecord, CarrierDraft>(
    (row) => ({ name: row.name }),
    (row, draft) => trimmed(row.name) === trimmed(draft.name),
  );

  constructor(readonly data: AdminDataStore, private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  trackById(_index: number, row: CarrierReferenceRecord) { return row.id; }

  get filteredCarriers() {
    const q = normalizedText(this.carrierFilter);
    return !q ? this.data.carriers : this.data.carriers.filter((carrier) => normalizedText(carrier.name).includes(q));
  }

  addCarrier() {
    const name = this.newCarrierName.trim();
    if (!name || this.data.busy) return;
    this.data.busy = true;
    this.api.createCarrier({ name }).subscribe({
      next: () => {
        this.data.busy = false;
        this.newCarrierName = '';
        this.toast.success(`${name} added to reusable carriers.`, 'Carrier added');
        this.data.loadCarriers();
      },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not add carrier.', 'Carrier not added'); },
    });
  }

  saveCarrier(carrier: CarrierReferenceRecord) {
    if (this.data.busy) return;
    const draft = this.edits.draft(carrier);
    this.data.busy = true;
    this.api.updateCarrier(carrier.id, { name: draft.name.trim(), active: carrier.active }).subscribe({
      next: (saved) => { this.data.busy = false; this.edits.saved(carrier); this.data.replaceCarrier(saved); this.toast.success('Carrier saved.', 'Reference data updated'); },
      error: (e) => { this.data.busy = false; this.edits.failed(carrier, e?.error?.message || 'Could not save carrier.'); },
    });
  }

  toggleCarrier(carrier: CarrierReferenceRecord) {
    if (this.data.busy) return;
    this.data.busy = true;
    this.api.updateCarrier(carrier.id, { active: !carrier.active }).subscribe({
      next: (saved) => { this.data.busy = false; this.data.replaceCarrier(saved); this.toast.success(`Carrier ${carrier.active ? 'disabled' : 'enabled'}.`, 'Reference data updated'); },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not update carrier.', 'Carrier not updated'); },
    });
  }
}
