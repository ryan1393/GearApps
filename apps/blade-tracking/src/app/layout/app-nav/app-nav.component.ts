import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { canEditMeshForgeApp, MESHFORGE_VERSION } from '@meshforge/manufacturing/shared/util-constants';
import { getDanaAppUrl } from '@meshforge/manufacturing/shared/dana-app-config';
import { IJwtPayload } from '@meshforge/manufacturing/shared/util-types';
import { DanaMobileNavDirective } from '@dana/ui';

@Component({
  selector: 'gear-nav',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, DanaMobileNavDirective],
  templateUrl: './app-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppNavComponent {
  readonly appVersion = MESHFORGE_VERSION;
  readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  searchValue = '';

  /**
   * The operations station has its own scan box for every step. A second "scan" box in the top bar
   * there would compete for the scanner, so it is hidden on the station.
   */
  readonly onOperationsStation = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => isOperationsStation(event.urlAfterRedirects)),
    ),
    { initialValue: isOperationsStation(this.router.url) },
  );

  get cutterBuilderUrl(): string {
    return getDanaAppUrl('cutterBuilder');
  }

  get greenshedUrl(): string {
    return getDanaAppUrl('greenshed');
  }

  get lapperUrl(): string {
    return getDanaAppUrl('lapper');
  }

  search(): void {
    const value = this.searchValue.trim();
    if (!value) return;
    void this.router.navigate(['/blades/inventory'], { queryParams: { serial: value } });
    this.searchValue = '';
  }

  canEdit(user: IJwtPayload): boolean {
    return canEditMeshForgeApp(
      'BLADE_TRACKING',
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

function isOperationsStation(url: string): boolean {
  return /^\/blades\/operations(?:[/?#]|$)/.test(url);
}
