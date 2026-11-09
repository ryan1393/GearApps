import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { GearToastHostComponent } from '@libs/frontend/util-common';
import { GreenshedNavComponent } from './layout/greenshed-nav/greenshed-nav.component';

@Component({
  standalone: true,
  imports: [RouterOutlet, GreenshedNavComponent, GearToastHostComponent],
  selector: 'gear-greenshed-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly browserTitle = inject(Title);

  title = 'greenshed';

  // Gear Apps browser tab identity v24
  private readonly pageTitles: ReadonlyArray<readonly [string, string]> = [
      ['/greenshed/machines', 'Running Machines'],
      ['/greenshed/setup', 'Machine Setup'],
      ['/greenshed/check', 'Quality Check'],
      ['/greenshed/pull', 'Pull Cutter'],
      ['/greenshed/lookup', 'Build Lookup'],
      ['/admin', 'Admin'],
      ['/login', 'Sign In'],
      ['/forgot-password', 'Forgot Password'],
      ['/reset-password', 'Reset Password'],
      ['/greenshed', 'Dashboard'],
      ['/', 'Dashboard'],
  ];

  private readonly browserTitleRouteSync = (() => {
    this.updateBrowserTitle(this.router.url);
    return this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.updateBrowserTitle(event.urlAfterRedirects);
    });
  })();

  private updateBrowserTitle(url: string): void {
    const cleanPath = url.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';
    const exact = this.pageTitles.find(([route]) => route === cleanPath);
    const prefix = exact ?? this.pageTitles.find(([route]) => route !== '/' && cleanPath.startsWith(`${route}/`));
    const page = prefix?.[1] ?? 'Gear Apps';
    this.browserTitle.setTitle(`${page} | Greenshed`);
  }

  get isLoginRoute(): boolean {
    return /^\/(login|forgot-password|reset-password)(?:[/?#]|$)/.test(this.router.url);
  }
}
