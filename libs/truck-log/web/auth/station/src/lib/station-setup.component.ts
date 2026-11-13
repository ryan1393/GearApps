import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { STATION_PAIRING_CODE_PATTERN } from '@truck-log/shared/contracts';
import { roleHome } from './station-roles';
import {
  STATION_SETUP_PATH,
  TruckLogStationAccess,
  normalizePairingCode,
  safeStationReturn,
  stationErrorMessage,
  stationKindLabel,
} from './station-access.service';

/** Public page where a guard PC or TV enters the one-time pairing code from Admin > Stations. */
@Component({
  selector: 'tl-station-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
  <main class="login-page">
    <section class="login-brand-panel" aria-label="Truck Log">
      <div class="login-brand-content">
        <div class="login-logo-row">
          <div class="login-logo-mark"><img src="assets/branding/dana-diamond.png" alt="Dana Incorporated" /></div>
          <div><div class="login-product">TRUCK LOG</div><div class="login-suite">Truck & Dock Operations</div></div>
        </div>
        <div class="login-brand-copy">
          <div class="login-eyebrow">STATION SETUP</div>
          <h1>Pair this<br />guard PC<br />or TV.</h1>
          <p>Each guard computer and dock TV is paired once with a code from Admin &gt; Stations.</p>
        </div>
        <div class="login-status"><span class="login-status-dot"></span><span>Truck Log system</span></div>
      </div>
    </section>

    <section class="login-form-panel">
      <div class="login-card" aria-labelledby="station-setup-title">
        <div class="login-card-heading">
          <div class="login-mobile-brand">
            <span class="login-mobile-mark"><img src="assets/branding/dana-diamond.png" alt="Dana Incorporated" /></span>
            <span>TRUCK LOG</span>
          </div>
          <div class="login-kicker">ONE-TIME CODE</div>
          <h2 id="station-setup-title">Set up this station</h2>
          <p>An administrator creates an 8-character pairing code in <b>Admin &gt; Stations</b>. Enter it below.</p>
        </div>

        <p class="dana-alert tl-station-current" role="status" *ngIf="station.session()?.station as current">
          This browser is already paired as <b>{{current.name}}</b> ({{kindLabel(current.kind)}}).
          A new code replaces that pairing. <a [routerLink]="'/'">Continue to Truck Log</a>
        </p>

        <div class="login-error" role="alert" *ngIf="error"><span class="login-error-icon">!</span><span>{{error}}</span></div>

        <form class="login-form" (ngSubmit)="pair()" novalidate>
          <label class="field-label" for="station-pairing-code">Pairing code</label>
          <input id="station-pairing-code" name="pairingCode" class="field-input" type="text"
            inputmode="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="11"
            placeholder="XXXX-XXXX" autofocus
            [class.field-error]="!!error"
            [ngModel]="code" (ngModelChange)="onCodeInput($event)"
            [attr.aria-invalid]="!!error" aria-describedby="station-pairing-hint"
            [disabled]="busy">
          <small id="station-pairing-hint" class="password-help tl-station-hint">Letters and numbers; the dash and spaces are optional.</small>
          <button type="submit" class="login-submit" [disabled]="busy" [attr.aria-busy]="busy">{{busy ? 'Pairing…' : 'Pair'}}</button>
        </form>

        <div class="login-footer">
          <span class="login-footer-dot"></span>
          <a routerLink="/admin/login" [queryParams]="{ returnTo: '/admin/stations' }">Administrator? Sign in</a>
        </div>
      </div>
    </section>
  </main>`,
})
export class StationSetupComponent implements OnInit {
  readonly station = inject(TruckLogStationAccess);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  code = '';
  busy = false;
  error = '';

  ngOnInit() {
    if (!this.station.session()) this.station.load().subscribe();
  }

  kindLabel(kind: string) { return stationKindLabel(kind); }

  onCodeInput(value: string) {
    // Uppercase as the guard types; keep a dash they typed, drop spaces.
    this.code = String(value ?? '').toUpperCase().replace(/\s+/g, '');
    if (this.error) this.error = '';
  }

  pair() {
    if (this.busy) return;
    const normalized = normalizePairingCode(this.code);
    if (!STATION_PAIRING_CODE_PATTERN.test(normalized)) {
      this.error = 'Enter the 8-character code exactly as the administrator gave it, for example ABCD-2345.';
      return;
    }
    this.code = normalized;
    this.busy = true;
    this.error = '';
    this.station.pair(normalized).subscribe({
      next: (session) => {
        this.busy = false;
        const returnTo = safeStationReturn(this.route.snapshot.queryParamMap.get('returnTo'));
        // Each kind starts on its own screen: TVs on the dock board TV, dock handhelds on the Dock Board.
        const home = roleHome(session.station?.kind);
        void this.router.navigateByUrl(returnTo === STATION_SETUP_PATH || returnTo === '/' ? home : returnTo);
      },
      error: (e) => {
        this.busy = false;
        this.error = stationErrorMessage(e, 'Pairing was not confirmed. Check the connection and try again.');
      },
    });
  }
}
