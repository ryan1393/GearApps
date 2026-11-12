import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { Poller, TruckLogApi, createPoller } from '@truck-log/web/data-access';
import { DashboardData, DockAgingSettingsRecord, TruckVisitRecord } from '@truck-log/shared/contracts';
import { elapsedSince, visitStatusLabel } from '@truck-log/web/domain';
import { DEFAULT_DOCK_AGING_SETTINGS, dockAgeTone } from '@truck-log/web/domain';
import { FinalCheckoutDialogComponent, StaleDataNoticeComponent, ToastService, jumpToSection } from '@truck-log/web/ui';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, FinalCheckoutDialogComponent, StaleDataNoticeComponent],
  template: `
  <header class="dana-page-header">
    <div><h1>Guard Dashboard</h1><p *ngIf="lastUpdated">Updated {{lastUpdated | date:'shortTime'}}</p></div>
    <div class="dana-actions"><button class="dana-btn" type="button" (click)="load()">Refresh</button><a class="dana-btn dana-btn-primary" routerLink="/check-in">+ Check In Truck</a></div>
  </header>
  <tl-stale-data-notice [stale]="!!data && poller.stale()" [lastUpdated]="lastUpdated" subject="The Guard Dashboard"></tl-stale-data-notice>

  <div class="dana-kpi-grid tl-kpi-links">
    <div class="dana-kpi-card"><a class="tl-kpi-jump" routerLink="/active-trucks" aria-label="Trucks on site: open Active Trucks"></a><div class="dana-kpi-label">Trucks on site</div><div class="dana-kpi-value">{{data?.open ?? 0}}</div></div>
    <div class="dana-kpi-card"><a class="tl-kpi-jump" routerLink="/dock-board" aria-label="Assigned to dock: open the Dock Board"></a><div class="dana-kpi-label">Assigned to dock</div><div class="dana-kpi-value">{{data?.atDock ?? 0}}</div></div>
    <div class="dana-kpi-card" [attr.data-tone]="(data?.awaitingExit ?? 0) > 0 ? 'warning' : null"><button type="button" class="tl-kpi-jump" aria-label="Needs guard checkout: go to the checkout queue" (click)="jumpToQueue()"></button><div class="dana-kpi-label">Needs guard checkout</div><div class="dana-kpi-value">{{data?.awaitingExit ?? 0}}</div></div>
    <div class="dana-kpi-card"><a class="tl-kpi-jump" routerLink="/history" aria-label="Checked out today: open Records and Paperwork"></a><div class="dana-kpi-label">Checked out today</div><div class="dana-kpi-value">{{data?.checkedOutToday ?? 0}}</div></div>
  </div>

  <section class="dana-panel tl-cap" id="guard-checkout-queue" tabindex="-1" aria-label="Guard checkout queue">
    <div class="dana-panel-header"><h2>Needs Guard Action</h2><span class="dana-count-badge" [attr.data-tone]="awaitingExit.length > 0 ? 'warning' : 'success'">{{awaitingExit.length}} waiting</span></div>
    <p class="dana-list-empty" *ngIf="data && !awaitingExit.length">No trucks waiting for final checkout.</p>
    <p class="dana-list-empty" *ngIf="!data && !poller.stale()">Loading the guard checkout queue…</p>
    <p class="dana-list-empty" role="alert" *ngIf="!data && poller.stale()">Could not load the guard checkout queue. Retrying automatically; trucks waiting for checkout are not shown until it loads.</p>
    <ul class="dana-action-list tl-scroll" *ngIf="awaitingExit.length">
      <li class="dana-action-row" *ngFor="let visit of awaitingExit">
        <div class="dana-action-main"><strong>{{visit.loadNumber || visit.visitReference}}</strong><span>{{visit.driverName}} · Trailer {{visit.trailerId}} · Dock {{visit.dockCode}}</span></div>
        <div class="dana-action-meta"><span>Dock complete</span><strong>{{visit.dockCompletedAt | date:'shortTime'}}</strong></div>
        <button class="dana-btn dana-btn-success" type="button" (click)="askCheckout(visit)">Final Checkout</button>
      </li>
    </ul>
  </section>

  <section class="dana-panel tl-fill">
    <div class="dana-panel-header">
      <h2>Recent Trucks On Site</h2>
      <div class="dana-actions"><span class="dana-muted" *ngIf="data">Showing {{data.activeTrucks.length}} of {{data.open}} on site</span><a routerLink="/active-trucks" class="dana-btn">View All Active Trucks</a></div>
    </div>
    <div class="dana-table-shell"><table class="dana-table tl-wide-table"><thead><tr><th>Load / Visit</th><th>Driver</th><th>Carrier</th><th>Trailer</th><th>Dock</th><th>Status</th><th>Guard In</th><th>On Site</th></tr></thead>
    <tbody><tr *ngFor="let visit of data?.activeTrucks" [attr.data-tone]="ageTone(visit)"><td><b>{{visit.loadNumber || 'No load #'}}</b><span class="dana-cell-sub">{{visit.visitReference}}</span></td>
    <td>{{visit.driverName}}</td><td>{{visit.carrierName || '—'}}</td><td class="dana-nowrap">{{visit.trailerId || '—'}}</td><td><b class="dana-nowrap">{{visit.dockCode || '—'}}</b></td>
    <td><span class="dana-status-badge" [attr.data-tone]="visit.status === 'DOCK_COMPLETE' ? 'warning' : 'info'">{{label(visit.status)}}</span></td><td class="dana-nowrap">{{visit.guardCheckInAt | date:'shortTime'}}</td><td class="dana-nowrap">{{elapsed(visit.guardCheckInAt)}}</td></tr>
    <tr *ngIf="data && !data.activeTrucks.length"><td colspan="8" class="dana-table-empty">No trucks are currently on site.</td></tr>
    <tr *ngIf="!data && !poller.stale()"><td colspan="8" class="dana-table-empty">Loading on-site trucks…</td></tr>
    <tr *ngIf="!data && poller.stale()"><td colspan="8" class="dana-table-empty">On-site trucks could not be loaded. Retrying automatically.</td></tr></tbody></table></div>
  </section>

  <tl-final-checkout-dialog *ngIf="checkoutTarget" [visit]="checkoutTarget" titleId="dashboard-final-checkout-title" (closed)="checkoutTarget = null" (completed)="checkedOut()"></tl-final-checkout-dialog>`
})
export class DashboardComponent implements OnInit {
  data?: DashboardData;
  checkoutTarget: TruckVisitRecord | null = null;
  aging: DockAgingSettingsRecord = { ...DEFAULT_DOCK_AGING_SETTINGS };
  /** Auto-refresh every 15 s; never overlapping, stale on failure. */
  poller!: Poller<{ data: DashboardData; aging: DockAgingSettingsRecord | null }>;
  private readonly destroyRef = inject(DestroyRef);

  constructor(private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  ngOnInit() {
    this.poller = createPoller({
      intervalMs: 15000,
      destroyRef: this.destroyRef,
      load: () => forkJoin({
        data: this.api.dashboard(),
        aging: this.api.dockAgingSettings().pipe(catchError(() => of(null))),
      }),
      next: ({ data, aging }) => { this.data = data; if (aging) this.aging = aging; },
      error: (_error, { manual }) => {
        if (manual) this.toast.error('Truck Log could not refresh. Check the System status at the top right.', 'Refresh failed');
      },
    });
  }

  get lastUpdated() { return this.poller.lastUpdated(); }

  get awaitingExit() {
    return this.data?.awaitingGuard ?? [];
  }

  load() {
    this.poller.refresh();
  }

  /** "Needs guard checkout" tile: focus the first Final Checkout button, or the queue when it is empty. */
  jumpToQueue() {
    const first = document.querySelector<HTMLElement>('#guard-checkout-queue .dana-btn-success');
    if (first) { first.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); first.focus({ preventScroll: true }); }
    else jumpToSection('guard-checkout-queue');
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
