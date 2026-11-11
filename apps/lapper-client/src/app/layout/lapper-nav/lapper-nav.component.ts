import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { DanaMobileNavDirective } from '@dana/ui';
import { AuthSessionService } from '@gearapps/manufacturing/frontend/data-access-user';
import { getDanaAppUrl } from '@gearapps/manufacturing/shared/dana-app-config';
import { GEAR_APPS_VERSION } from '@gearapps/shared/domain';

@Component({
  selector: 'gear-lapper-nav',
  imports: [AsyncPipe, FormsModule, RouterLink, RouterLinkActive, DanaMobileNavDirective],
  templateUrl: './lapper-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LapperNavComponent {
  protected readonly appVersion = GEAR_APPS_VERSION;
  protected readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  protected searchValue = '';

  protected readonly bladeTrackingUrl = getDanaAppUrl('bladeTracking');
  protected readonly cutterBuilderUrl = getDanaAppUrl('cutterBuilder');
  protected readonly greenshedUrl = getDanaAppUrl('greenshed');

  /** Jumps to the lapping summary for a gearset number or machine asset ID. */
  protected search(): void {
    const value = this.searchValue.trim();
    if (!value) return;
    void this.router.navigate(['/lapping-summaries'], { queryParams: { q: value } });
    this.searchValue = '';
  }

  protected logout(): void {
    this.session.logout();
    void this.router.navigate(['/login']);
  }

  protected initials(email?: string): string {
    if (!email) return 'GA';
    return (email.split('@')[0] ?? email).slice(0, 2).toUpperCase();
  }
}
