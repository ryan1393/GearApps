import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, LayoutService, SCALE_MAX, SCALE_MIN } from '@gearapps/client/core';
import { DanaMobileNavDirective, DanaToastHostComponent } from '@dana/ui';
import { GEAR_APPS_VERSION } from '@gearapps/shared/domain';
import { HealthService } from './health.service';
import { NAV } from './nav';

@Component({
  selector: 'gear-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DanaMobileNavDirective, DanaToastHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);
  protected readonly health = inject(HealthService);
  private readonly router = inject(Router);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly appVersion = GEAR_APPS_VERSION;
  protected readonly nav = NAV;
  protected readonly SCALE_MIN = SCALE_MIN;
  protected readonly SCALE_MAX = SCALE_MAX;

  protected toggleNavigation(nav: DanaMobileNavDirective): void {
    nav.toggle();
    if (nav.open) {
      afterNextRender(() => {
        this.element.nativeElement.querySelector<HTMLElement>('#lapper-navigation a')?.focus();
      }, { injector: this.injector });
    }
  }

  protected closeNavigation(nav: DanaMobileNavDirective): void {
    nav.close();
    this.element.nativeElement.querySelector<HTMLElement>('.dana-menu-button')?.focus();
  }

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
