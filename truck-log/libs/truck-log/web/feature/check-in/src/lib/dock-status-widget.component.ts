import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TruckVisitRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';

/**
 * Read-only "who is at this dock" preview for the selected dock on Check-In.
 * Hosted on the form's grid cell; never reserves a dock or blocks check-in.
 */
@Component({
  selector: 'div[tlCheckinDockStatus]',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'dana-alert tl-dock-status', '[class.dana-alert-warning]': 'dockStatusCheckedAt && dockAssignedVisits.length > 0' },
  template: `
    <div class="tl-dock-status-head"><b>Dock {{dockCode}} activity</b><button type="button" class="dana-btn dana-btn-sm" [disabled]="dockStatusLoading" (click)="refreshDockStatus()">{{dockStatusLoading ? 'Checking…' : 'Refresh'}}</button></div>
    <p *ngIf="dockStatusLoading">Reading assigned trucks from the Dock Board…</p>
    <p *ngIf="!dockStatusLoading && dockStatusError" class="dana-field-error">{{dockStatusError}}</p>
    <p *ngIf="!dockStatusLoading && !dockStatusError && dockStatusCheckedAt && dockAssignedVisits.length">{{dockAssignedVisits.length}} truck(s) at Dock {{dockCode}}. Confirm before assigning another.</p>
    <p *ngIf="!dockStatusLoading && !dockStatusError && dockStatusCheckedAt && !dockAssignedVisits.length">No trucks at Dock {{dockCode}}.</p>
    <div class="dana-chip-list" *ngIf="!dockStatusLoading && dockStatusCheckedAt && dockAssignedVisits.length"><span class="dana-chip" *ngFor="let visit of dockAssignedVisits | slice:0:3">{{visit.loadNumber || visit.visitReference}} · {{visit.driverName || 'Driver unknown'}}</span><span class="dana-chip" *ngIf="dockAssignedVisits.length > 3">+{{dockAssignedVisits.length - 3}} additional truck(s)</span></div>
    <small>Checked<ng-container *ngIf="dockStatusCheckedAt"> {{dockStatusCheckedAt | date:'shortTime'}}</ng-container>. Information only; it doesn't reserve the dock.</small>`,
})
export class DockStatusWidgetComponent implements OnChanges, OnDestroy {
  /** The dock selected on the Check-In form. */
  @Input() dockCode = '';
  dockStatusVisits: TruckVisitRecord[] = [];
  dockStatusLoading = false;
  dockStatusCheckedAt: Date | null = null;
  dockStatusError = '';
  private dockStatusGeneration = 0;
  private dockStatusDestroyed = false;

  constructor(private readonly api: TruckLogApi) {}

  ngOnChanges() {
    this.resetDockStatus();
    if (this.dockCode.trim()) this.refreshDockStatus();
  }

  ngOnDestroy() {
    this.dockStatusGeneration += 1;
    this.dockStatusDestroyed = true;
  }

  get dockAssignedVisits() {
    const selected = this.dockCode.trim().toUpperCase();
    return selected ? this.dockStatusVisits.filter((visit) => visit.dockCode?.trim().toUpperCase() === selected && visit.status === 'DOCK_ASSIGNED') : [];
  }

  private resetDockStatus() {
    this.dockStatusGeneration += 1;
    this.dockStatusVisits = [];
    this.dockStatusLoading = false;
    this.dockStatusCheckedAt = null;
    this.dockStatusError = '';
  }

  refreshDockStatus() {
    const selected = this.dockCode.trim().toUpperCase();
    if (!selected || this.dockStatusDestroyed) return;
    const generation = ++this.dockStatusGeneration;
    this.dockStatusLoading = true;
    this.dockStatusCheckedAt = null;
    this.dockStatusError = '';
    this.api.dockBoard('checkin-' + Date.now() + '-' + generation).subscribe({
      next: (visits) => {
        if (this.dockStatusDestroyed || generation !== this.dockStatusGeneration || selected !== this.dockCode.trim().toUpperCase()) return;
        this.dockStatusVisits = visits.filter((visit) => visit.status === 'DOCK_ASSIGNED');
        this.dockStatusLoading = false;
        this.dockStatusCheckedAt = new Date();
      },
      error: () => {
        if (this.dockStatusDestroyed || generation !== this.dockStatusGeneration || selected !== this.dockCode.trim().toUpperCase()) return;
        this.dockStatusVisits = [];
        this.dockStatusLoading = false;
        this.dockStatusError = 'Dock activity could not be checked. Confirm the assignment using the Dock Board; check-in is not blocked.';
      },
    });
  }
}
