import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastHostComponent } from '@truck-log/web/ui';
import { TRUCK_LOG_VERSION } from '@truck-log/shared/contracts';
import { TruckLogStationAccess, isStationPublicPath, roleCanOpen, roleHome, stationKindLabel, type TruckLogScreen } from '@truck-log/web/auth/station';

type HealthState = 'checking' | 'good' | 'warning' | 'bad';
type CoreReadiness = 'checking' | 'ready' | 'degraded' | 'offline';

type RxoSystemStatusDetail = {
  clear?: boolean;
  phase?: string;
  active?: boolean;
  failed?: boolean;
  stale?: boolean;
  controlAvailable?: boolean;
  exporterRunning?: boolean;
  detail?: string;
  receivedAt?: number;
};

const RXO_SYSTEM_STATUS_EVENT = 'truck-log-rxo-system-status';
const ACTIVE_RXO_PHASE_LABELS: Record<string, string> = {
  QUEUED: 'RXO Queued',
  RUNNING: 'RXO Running',
  EXPORTING: 'RXO Exporting',
  SYNCING: 'RXO Syncing',
  IMPORTING: 'RXO Importing',
};
const WARNING_RXO_PHASE_LABELS: Record<string, string> = {
  STALLED: 'RXO Scan Stalled',
  RECOVERING: 'RXO Recovering',
  RETRYING: 'RXO Retrying',
  NEEDS_REVIEW: 'RXO Needs Review',
};

@Component({
  selector: 'truck-log-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastHostComponent],
  template: `
  @if (adminLoginPageMode || stationSetupPageMode) {
    <router-outlet />
  } @else {
  <div class="dana-app-shell" [class.is-fullscreen]="tvDisplayMode" [attr.data-role]="station.role()">
    <aside class="dana-sidebar" [class.is-open]="mobileNavOpen" aria-label="Truck Log navigation">
      <a [routerLink]="home" class="dana-brand-row" (click)="closeMobileNav()">
        <span class="dana-brand-mark" aria-hidden="true"><img src="assets/branding/dana-diamond.png" alt=""></span>
        <span class="dana-brand-copy"><strong>Truck Log</strong><span>Guard Shack</span></span>
      </a>

      <nav aria-label="Truck Log" (click)="closeMobileNav()">
        <!-- Links follow the browser's role (station kind or administrator); see web/auth/station station-roles.ts. -->
        @if (can('dashboard')) {
        <a routerLink="/" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">G</span><span>Guard Dashboard</span></a>
        }

        @if (can('check-in') || can('dock-board') || can('active-trucks')) {
        <div class="dana-nav-group">
          <div class="dana-nav-heading">Operations</div>
          @if (can('check-in')) { <a routerLink="/check-in" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">+</span><span>Check In Truck</span></a> }
          @if (can('dock-board')) { <a routerLink="/dock-board" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">D</span><span>Dock Board</span></a> }
          @if (can('active-trucks')) { <a routerLink="/active-trucks" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">T</span><span>Active Trucks</span></a> }
        </div>
        }

        @if (can('history')) {
        <div class="dana-nav-group">
          <div class="dana-nav-heading">Records</div>
          <a routerLink="/history" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">R</span><span>Records &amp; Paperwork</span></a>
        </div>
        }

        @if (can('rxo') || can('rxo-expedite')) {
        <div class="dana-nav-group">
          <div class="dana-nav-heading">Integrations</div>
          @if (can('rxo')) { <a routerLink="/rxo" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">X</span><span>RXO Control Center</span></a> }
          @if (can('rxo-expedite')) { <a routerLink="/rxo-expedite" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">E</span><span>RXO Expedite</span></a> }
        </div>
        }

        @if (can('admin')) {
        <div class="dana-nav-group">
          <div class="dana-nav-heading">Administration</div>
          <a routerLink="/admin" routerLinkActive="is-active" ariaCurrentWhenActive="page" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">A</span><span>Administration</span></a>
        </div>
        }

        <!-- TV displays: read-only, no operational actions -->
        @if (can('tv')) {
        <div class="dana-nav-group">
          <div class="dana-nav-heading">TV Displays</div>
          <a routerLink="/tv/docks" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">TV</span><span>Dockworker TV</span></a>
          <a routerLink="/tv/management" class="dana-side-link"><span class="dana-nav-icon" aria-hidden="true">TV</span><span>Management TV</span></a>
        </div>
        }
      </nav>

      <div class="dana-sidebar-footer">
        @if (station.session(); as access) {
          @if (access.station; as paired) {
            <div class="dana-sidebar-identity" [title]="'This browser is paired as ' + paired.name">
              <strong>{{ paired.name }}</strong>
              <span>{{ kindLabel(paired.kind) }}</span>
            </div>
          } @else if (access.admin) {
            <div class="dana-sidebar-identity" title="No station is paired; an administrator session authorizes this browser.">
              <strong>Admin session</strong><span>No station paired</span>
            </div>
          }
        }
        <div class="dana-sidebar-version">Truck Log v{{ version }}</div>
      </div>
    </aside>
    <div class="dana-sidebar-backdrop" (click)="closeMobileNav()"></div>

    <div class="dana-main">
      <header class="dana-topbar">
        <button class="dana-menu-button" type="button" aria-label="Open navigation" [attr.aria-expanded]="mobileNavOpen" (click)="toggleMobileNav()">&#9776;</button>
        <form class="dana-global-search" role="search" (submit)="$event.preventDefault(); search(globalSearch.value)">
          <input #globalSearch type="search" placeholder="Find load, driver, phone, trailer, carrier…" aria-label="Find load, driver, phone, trailer, carrier">
        </form>
        <div class="dana-topbar-spacer"></div>
        <button
          type="button"
          class="dana-pill-button"
          [attr.data-tone]="healthState === 'good' ? 'success' : healthState === 'bad' ? 'danger' : healthState === 'warning' ? 'warning' : null"
          (click)="checkHealth()"
          [title]="healthDetail">
          <span aria-hidden="true"></span>{{healthLabel}}
        </button>
      </header>

      <!-- Dock handheld (CK65): its two screens as tabs under the top bar, thumb-reachable on small screens. -->
      @if (station.role() === 'DOCK') {
        <nav class="tl-role-tabs" aria-label="Dock handheld screens">
          <a routerLink="/dock-board" routerLinkActive="is-active" ariaCurrentWhenActive="page">Dock Board</a>
          <a routerLink="/history" routerLinkActive="is-active" ariaCurrentWhenActive="page">Records &amp; Paperwork</a>
        </nav>
      }
      <main class="dana-page"><router-outlet /></main>
    </div>

    <truck-log-toast-host />
  </div>
  }`
})
export class AppComponent implements OnInit, OnDestroy {
  readonly version = TRUCK_LOG_VERSION;
  healthState: HealthState = 'checking';
  healthLabel = 'Checking System';
  healthDetail = 'Checking API, database, and document storage.';
  mobileNavOpen = false;

  private healthTimer?: number;
  private healthRetryTimer?: number;
  private healthRequestInFlight = false;
  private consecutiveHealthFailures = 0;
  private coreReadiness: CoreReadiness = 'checking';
  private coreHealthDetail = 'Checking API, database, and document storage.';
  private rxoStatus: RxoSystemStatusDetail | null = null;
  /** Server build version first seen by this page; a later change means a redeploy. */
  private firstServerVersion = '';

  constructor(
    private readonly api: TruckLogApi,
    private readonly router: Router,
    readonly station: TruckLogStationAccess,
  ) {}

  ngOnInit() {
    // Station sign-in: learn which station (or admin session) authorizes this browser.
    // An unpaired browser goes to /station/setup before the guard pages start failing.
    this.station.load().subscribe(() => {
      if (this.station.needsSetup() && !isStationPublicPath(location.pathname) && !location.pathname.startsWith('/admin')) {
        this.station.redirectToSetup();
      }
    });
    this.checkHealth();
    this.healthTimer = window.setInterval(() => this.checkHealth(), 30000);
  }

  ngOnDestroy() {
    if (this.healthTimer) window.clearInterval(this.healthTimer);
    if (this.healthRetryTimer) window.clearTimeout(this.healthRetryTimer);
  }

  @HostListener(`window:${RXO_SYSTEM_STATUS_EVENT}`, ['$event'])
  onRxoSystemStatus(event: Event) {
    const detail = (event as CustomEvent<RxoSystemStatusDetail>).detail;
    this.rxoStatus = !detail || detail.clear
      ? null
      : { ...detail, receivedAt: detail.receivedAt ?? Date.now() };
    this.updateHealthPresentation();
  }

  /** Whether the navigation offers a screen. Hidden while the role loads; everything shows if it cannot be read. */
  can(screen: TruckLogScreen): boolean {
    const role = this.station.role();
    return role ? roleCanOpen(role, screen) : this.station.state() === 'unavailable';
  }

  get home(): string { return roleHome(this.station.role()); }

  readonly kindLabel = stationKindLabel;

  toggleMobileNav() {
    this.mobileNavOpen = !this.mobileNavOpen;
  }

  closeMobileNav() {
    this.mobileNavOpen = false;
  }

  search(value: string) {
    const q = value.trim();
    this.closeMobileNav();
    // 'reload' lets the Records page re-run an identical search instead of ignoring it.
    this.router.navigate(['/history'], { queryParams: q ? { q } : {}, onSameUrlNavigation: 'reload' });
  }

  checkHealth() {
    if (this.healthRequestInFlight) return;

    this.healthRequestInFlight = true;
    if (this.coreReadiness === 'checking') {
      this.healthState = 'checking';
      this.healthLabel = 'Checking System';
    }

    this.api.health().subscribe({
      next: (health) => {
        this.healthRequestInFlight = false;
        this.consecutiveHealthFailures = 0;
        this.noteServerVersion(health.version);
        this.coreReadiness = 'ready';
        this.coreHealthDetail = `Database: ${health.database}; Paperwork storage: ${health.documentStorage}`;
        this.updateHealthPresentation();
      },
      error: (readinessError) => {
        this.api.healthLive().subscribe({
          next: (live) => {
            this.healthRequestInFlight = false;
            this.noteServerVersion(live.version);
            this.consecutiveHealthFailures = 0;
            this.coreReadiness = 'degraded';
            this.coreHealthDetail = readinessError?.error?.message
              || 'The API is online, but database or document storage readiness needs attention.';
            this.updateHealthPresentation();
          },
          error: (liveError) => {
            this.healthRequestInFlight = false;
            this.consecutiveHealthFailures += 1;

            if (this.coreReadiness === 'ready' && this.consecutiveHealthFailures < 3) {
              this.coreHealthDetail = `Transient health-check failure; retry ${this.consecutiveHealthFailures}/3.`;
              this.updateHealthPresentation();
              this.scheduleHealthRetry();
              return;
            }

            this.coreReadiness = 'offline';
            this.coreHealthDetail = liveError?.error?.message
              || readinessError?.error?.message
              || 'Truck Log API is unavailable.';
            this.updateHealthPresentation();
          },
        });
      },
    });
  }

  /**
   * Unattended TV screens reload themselves after a redeploy so they never run
   * an old web build against a new API. Compared with the first version this page
   * observed (not the compiled constant) so a mismatched deploy cannot loop.
   */
  private noteServerVersion(version: unknown) {
    if (typeof version !== 'string' || !version) return;
    if (!this.firstServerVersion) { this.firstServerVersion = version; return; }
    if (version === this.firstServerVersion || !this.tvDisplayMode) return;
    window.location.reload();
  }

  private scheduleHealthRetry() {
    if (this.healthRetryTimer) window.clearTimeout(this.healthRetryTimer);
    this.healthRetryTimer = window.setTimeout(() => this.checkHealth(), 3000);
  }

  private updateHealthPresentation() {
    if (this.coreReadiness === 'offline') {
      this.healthState = 'bad';
      this.healthLabel = 'System Offline';
      this.healthDetail = this.coreHealthDetail;
      return;
    }

    if (this.coreReadiness === 'checking') {
      this.healthState = 'checking';
      this.healthLabel = 'Checking System';
      this.healthDetail = this.coreHealthDetail;
      return;
    }

    const rxo = this.currentRxoStatus();
    if (!rxo) {
      this.healthState = 'good';
      this.healthLabel = 'System Ready';
      this.healthDetail = this.coreHealthDetail;
      return;
    }

    const phase = String(rxo.phase ?? '').toUpperCase();
    const activeLabel = ACTIVE_RXO_PHASE_LABELS[phase];
    const warningPhaseLabel = WARNING_RXO_PHASE_LABELS[phase];

    if (warningPhaseLabel) {
      this.healthState = 'warning';
      this.healthLabel = warningPhaseLabel;
      this.healthDetail = `Core system is online. ${
        rxo.detail ||
        (phase === 'NEEDS_REVIEW'
          ? 'Automatic RXO recovery did not complete; existing data remains available.'
          : 'The RXO scheduler detected a stalled export and is recovering it automatically.')
      }`;
      return;
    }

    if (rxo.active && activeLabel) {
      this.healthState = 'good';
      this.healthLabel = activeLabel;
      this.healthDetail =
        this.coreReadiness === 'degraded'
          ? `System is online and RXO is active. ${rxo.detail || `RXO phase: ${phase}.`} Readiness check is retrying: ${this.coreHealthDetail}`
          : `System ready. ${rxo.detail || `RXO phase: ${phase}.`}`;
      return;
    }

    if (this.coreReadiness === 'degraded') {
      this.healthState = 'warning';
      this.healthLabel = 'System Degraded';
      this.healthDetail = this.coreHealthDetail;
      return;
    }

    if (rxo.failed) {
      this.healthState = 'warning';
      this.healthLabel = 'RXO Needs Review';
      this.healthDetail = `Core system is ready. ${rxo.detail || 'The latest RXO refresh needs review.'}`;
      return;
    }

    if (rxo.stale) {
      this.healthState = 'warning';
      this.healthLabel = 'RXO Status Stale';
      this.healthDetail = `Core system is ready. ${rxo.detail || 'Waiting for fresh RXO scheduler status.'}`;
      return;
    }

    if (!rxo.controlAvailable && rxo.exporterRunning !== true) {
      this.healthState = 'warning';
      this.healthLabel = 'RXO Controls Offline';
      this.healthDetail = `Core system is ready. ${rxo.detail || 'RXO remote controls are unavailable.'}`;
      return;
    }

    this.healthState = 'good';
    this.healthLabel = 'System Ready';
    this.healthDetail = this.coreHealthDetail;
  }

  private currentRxoStatus() {
    if (!this.rxoStatus) return null;
    const receivedAt = Number(this.rxoStatus.receivedAt ?? 0);
    if (!receivedAt || Date.now() - receivedAt > 20000) {
      return { ...this.rxoStatus, active: false, stale: true };
    }
    return this.rxoStatus;
  }


  /** only the Admin sign-in route uses the standalone Dana-style page. */
  get adminLoginPageMode(): boolean { return /^\/admin\/login(?:[?#]|$)/.test(this.router.url); }

  /** station pairing is shown without navigation chrome: the browser cannot use those pages yet. */
  get stationSetupPageMode(): boolean { return /^\/station\/setup(?:[?#]|$)/.test(this.router.url); }

  /** hide operational chrome only on the two dedicated TV routes. */
  get tvDisplayMode(): boolean { return /^\/tv\/(docks|management)(?:[?#]|$)/.test(this.router.url); }
}
