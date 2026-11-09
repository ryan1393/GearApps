import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Dana sign-in page frame: brand panel on the left, card on the right. Shared by login & register. */
@Component({
  selector: 'gear-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login-page">
      <section class="login-brand-panel" aria-label="GearApps">
        <div class="login-brand-content">
          <div class="login-logo-row">
            <div class="login-logo-mark">
              <img src="assets/branding/dana-diamond.png" alt="Dana Incorporated" />
            </div>
            <div>
              <div class="login-product">GEARAPPS</div>
              <div class="login-suite">Gear Lapping</div>
            </div>
          </div>
          <div class="login-brand-copy">
            <div class="login-eyebrow">PLANT FLOOR SYSTEMS</div>
            <h1>Cell Dashboard.<br />Lapping Summaries.<br />Cutter Tracking.</h1>
            <p>
              Live lapping cells, machine parameters by gearset, and the master data behind them —
              in one workspace.
            </p>
          </div>
          <div class="login-status">
            <span class="login-status-dot"></span><span>GearApps · Lapper</span>
          </div>
        </div>
      </section>

      <section class="login-form-panel">
        <div class="login-card">
          <div class="login-card-heading">
            <div class="login-mobile-brand">
              <span class="login-mobile-mark"
                ><img src="assets/branding/dana-diamond.png" alt="Dana Incorporated"
              /></span>
              <span>GEARAPPS</span>
            </div>
            <div class="login-kicker">{{ kicker() }}</div>
            <h2>{{ title() }}</h2>
            <p>{{ description() }}</p>
          </div>
          <ng-content />
        </div>
      </section>
    </main>
  `,
})
export class AuthPageComponent {
  readonly kicker = input('WELCOME BACK');
  readonly title = input.required<string>();
  readonly description = input('');
}
