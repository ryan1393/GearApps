import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthSessionService } from '@libs/frontend/data-access-user';
import { canEditGearApp, GEAR_APPS_VERSION } from '@libs/shared/util-constants';
import { getDanaAppUrl } from '@libs/shared/dana-app-config';
import { IJwtPayload } from '@libs/shared/util-types';
import { DanaMobileNavDirective } from '@dana/ui';

@Component({
  selector: 'gear-cutter-builder-nav',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, DanaMobileNavDirective],
  templateUrl: './cutter-builder-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CutterBuilderNavComponent {
  readonly appVersion = GEAR_APPS_VERSION;
  readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  searchValue = '';

  get bladeTrackingUrl(): string {
    return getDanaAppUrl('bladeTracking');
  }

  get greenshedUrl(): string {
    return getDanaAppUrl('greenshed');
  }

  search(): void {
    const value = this.searchValue.trim();
    if (!value) return;
    void this.router.navigate(['/cutter-builder/lookup'], {
      queryParams: { build: value },
    });
    this.searchValue = '';
  }

  canEdit(user: IJwtPayload): boolean {
    return canEditGearApp(
      'CUTTER_BUILDER',
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
