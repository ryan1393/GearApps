import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthSessionService } from '@gearapps/manufacturing/frontend/data-access-user';
import { canEditGearApp, GEAR_APPS_VERSION } from '@gearapps/manufacturing/shared/util-constants';
import { getDanaAppUrl } from '@gearapps/manufacturing/shared/dana-app-config';
import { IJwtPayload } from '@gearapps/manufacturing/shared/util-types';
import { DanaMobileNavDirective } from '@dana/ui';

@Component({
  selector: 'gear-greenshed-nav',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, DanaMobileNavDirective],
  templateUrl: './greenshed-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GreenshedNavComponent {
  readonly appVersion = GEAR_APPS_VERSION;
  readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  searchValue = '';

  get bladeTrackingUrl(): string {
    return getDanaAppUrl('bladeTracking');
  }

  get cutterBuilderUrl(): string {
    return getDanaAppUrl('cutterBuilder');
  }

  search(): void {
    const value = this.searchValue.trim();
    if (!value) return;
    void this.router.navigate(['/greenshed/lookup'], {
      queryParams: { build: value },
    });
    this.searchValue = '';
  }

  canEdit(user: IJwtPayload): boolean {
    return canEditGearApp(
      'GREENSHED',
      user.role,
      user.departmentCode,
    );
  }

  logout(): void {
    this.session.logout();
    void this.router.navigate(['/login']);
  }

  initials(email?: string): string {
    if (!email) return 'GA';
    return (email.split('@')[0] ?? email).slice(0, 2).toUpperCase();
  }
}
