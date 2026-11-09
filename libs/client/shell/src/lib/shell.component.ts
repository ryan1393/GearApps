import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, LayoutService, SCALE_MAX, SCALE_MIN } from '@gearapps/client/core';
import { DanaToastHostComponent } from '@dana/ui';
import { HealthService } from './health.service';
import { NAV } from './nav';

@Component({
  selector: 'gear-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DanaToastHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);
  protected readonly health = inject(HealthService);
  private readonly router = inject(Router);

  protected readonly nav = NAV;
  protected readonly mobileNavOpen = signal(false);
  protected readonly SCALE_MIN = SCALE_MIN;
  protected readonly SCALE_MAX = SCALE_MAX;

  protected initials() {
    const name = this.auth.displayName();
    return name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('');
  }

  protected signOut() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
