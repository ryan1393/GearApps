import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { Poller, TruckLogApi, createPoller } from '@truck-log/web/data-access';
import { DockAgingSettingsRecord, TruckVisitRecord } from '@truck-log/shared/contracts';
import { elapsedSince, visitStatusLabel } from '@truck-log/web/domain';
import { DEFAULT_DOCK_AGING_SETTINGS, dockAgeTone } from '@truck-log/web/domain';
import { FinalCheckoutDialogComponent, StaleDataNoticeComponent, ToastService } from '@truck-log/web/ui';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, FinalCheckoutDialogComponent, StaleDataNoticeComponent],
  template: `
  <header class="dana-page-header">
    <div><h1>Active Trucks</h1><p>{{visits.length}} on site · {{awaitingExit.length}} ready for checkout<span *ngIf="lastUpdated"> · Updated {{lastUpdated | date:'shortTime'}}</span></p></div>
    <div class="dana-actions"><button class="dana-btn" type="button" (click)="load()">Refresh</button></div>
  </header>
  <tl-stale-data-notice [stale]="poller.hasData() && poller.stale()" [lastUpdated]="lastUpdated" subject="Active Trucks"></tl-stale-data-notice>

  <section class="dana-panel tl-cap">
    <div class="dana-panel-header"><h2>Ready for Final Guard Checkout</h2><span class="dana-count-badge" [attr.data-tone]="awaitingExit.length > 0 ? 'warning' : null">{{awaitingExit.length}}</span></div>
    <ul class="dana-action-list tl-scroll" *ngIf="awaitingExit.length">
      <li class="dana-action-row" *ngFor="let v of awaitingExit">
        <div class="dana-action-main"><strong>{{v.loadNumber || v.visitReference}}</strong><span>{{v.driverName}} · {{v.carrierName}} · Trailer {{v.trailerId}}</span></div>
        <div class="dana-action-meta"><span>Dock</span><strong>{{v.dockCode}}</strong></div>
        <button class="dana-btn dana-btn-success tl-write" type="button" (click)="askCheckout(v)">Final Checkout</button>
      </li>
    </ul>
    <p class="dana-list-empty" *ngIf="!awaitingExit.length && poller.hasData()">No trucks ready for final checkout in this view.{{q ? ' Clear the search to see all on-site visits.' : ''}}</p>
  </section>

  <section class="dana-panel tl-fill">
    <div class="dana-panel-header">
      <h2>All On-Site Visits</h2>
      <form class="tl-search" role="search" (submit)="$event.preventDefault(); load()">
        <input class="dana-input" type="search" name="q" aria-label="Search on-site truck visits" [(ngModel)]="q" placeholder="Load, driver, trailer, carrier…">
        <button class="dana-btn" type="submit">Search</button>
        <button class="dana-btn dana-btn-ghost" type="button" *ngIf="q" (click)="q=''; load()">Clear</button>
      </form>
    </div>
    <p *ngIf="q" class="dana-note tl-panel-note">A typed search pauses automatic refresh. Press Search or Enter to apply it.</p>
    <div class="dana-table-shell" tabindex="0" role="region" aria-label="On-site truck visits"><table class="dana-table tl-active-table tl-wide-table"><thead><tr><th>Load / Visit</th><th>Carrier</th><th>Driver</th><th>Trailer</th><th>Dock</th><th>Status</th><th>On Site</th><th><span class="dana-nowrap">Quick actions</span></th></tr></thead><tbody>
    <tr *ngFor="let v of visits" [attr.data-tone]="ageTone(v)"><td><b class="dana-nowrap">{{v.loadNumber || 'No load #'}}</b><span class="dana-cell-sub">{{v.visitReference}}</span></td><td>{{v.carrierName || '—'}}</td><td>{{v.driverName}}</td><td class="dana-nowrap">{{v.trailerId || '—'}}</td><td><b class="dana-nowrap">{{v.dockCode || '—'}}</b></td>
    <td><span class="dana-status-badge" [attr.data-tone]="v.status === 'DOCK_COMPLETE' ? 'warning' : 'info'">{{label(v.status)}}</span></td><td class="dana-nowrap">{{elapsed(v.guardCheckInAt)}}</td>
    <td><div class="tl-row-actions"><button *ngIf="v.status==='DOCK_COMPLETE'" class="dana-btn dana-btn-success dana-btn-sm tl-write" type="button" (click)="askCheckout(v)">Final Checkout</button><a class="dana-btn dana-btn-sm" [href]="api.slipUrl(v.id)" target="_blank">Slip</a><a class="dana-btn dana-btn-sm" routerLink="/history" [queryParams]="{q:v.visitReference}">Record</a></div></td></tr>
    <tr *ngIf="!visits.length && !poller.hasData() && !poller.stale()"><td colspan="8" class="dana-table-empty">Loading on-site visits…</td></tr>
    <tr *ngIf="!visits.length && !poller.hasData() && poller.stale()"><td colspan="8" class="dana-table-empty" role="alert">On-site visits could not be loaded. Retrying automatically; select Refresh to try now.</td></tr>
    <tr *ngIf="!visits.length && poller.hasData()"><td colspan="8" class="dana-table-empty">{{q ? 'No on-site visits in the current search results.' : 'No active truck visits.'}}</td></tr></tbody></table></div>
  </section>

  <tl-final-checkout-dialog *ngIf="checkoutTarget" [visit]="checkoutTarget" titleId="active-final-checkout-title" (closed)="checkoutTarget = null" (completed)="checkedOut()"></tl-final-checkout-dialog>`
})
export class ActiveTrucksComponent implements OnInit {
  visits: TruckVisitRecord[] = [];
  q = '';
  checkoutTarget: TruckVisitRecord | null = null;
  aging: DockAgingSettingsRecord = { ...DEFAULT_DOCK_AGING_SETTINGS };
  /**
   * Auto-refresh every 15 s while the search field is empty. A search (or Refresh)
   * cancels any in-flight background request, so an older unfiltered response can
   * never overwrite the search results.
   */
  poller!: Poller<{ visits: TruckVisitRecord[]; aging: DockAgingSettingsRecord | null }>;
  private readonly destroyRef = inject(DestroyRef);

  constructor(public readonly api: TruckLogApi, private readonly toast: ToastService) {}

  ngOnInit() {
    this.poller = createPoller({
      intervalMs: 15000,
      destroyRef: this.destroyRef,
      when: () => !this.q,
      load: () => forkJoin({
        visits: this.api.active(this.q),
        aging: this.api.dockAgingSettings().pipe(catchError(() => of(null))),
      }),
      next: ({ visits, aging }) => { this.visits = visits; if (aging) this.aging = aging; },
      error: (_error, { manual }) => {
        if (manual) this.toast.error('Could not refresh active trucks. Check System status.', 'Refresh failed');
      },
    });
  }

  get lastUpdated() { return this.poller.lastUpdated(); }

  /** Longest wait first, the same order as the Guard Dashboard's "Needs Guard Action" list. */
  get awaitingExit() {
    const completedAt = (v: TruckVisitRecord) => Date.parse(v.dockCompletedAt ?? v.guardCheckInAt ?? '') || 0;
    return this.visits.filter((v) => v.status === 'DOCK_COMPLETE').sort((a, b) => completedAt(a) - completedAt(b));
  }

  load() {
    this.poller.refresh();
  }

  ageTone(visit: TruckVisitRecord) {
    return dockAgeTone(visit, this.aging);
  }

  readonly label = visitStatusLabel;
  readonly elapsed = elapsedSince;

  askCheckout(visit: TruckVisitRecord) {
    if (this.checkoutTarget) return;
    this.checkoutTarget = visit;
  }

  checkedOut() {
    this.checkoutTarget = null;
    this.load();
  }
}
