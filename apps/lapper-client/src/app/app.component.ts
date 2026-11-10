import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { GearToastHostComponent } from '@gearapps/manufacturing/frontend/util-common';
import { LapperNavComponent } from './layout/lapper-nav/lapper-nav.component';

@Component({
  imports: [RouterOutlet, LapperNavComponent, GearToastHostComponent],
  selector: 'gear-lapper-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly browserTitle = inject(Title);

  /** Browser tab identity, matching the other Gear Apps: "<Page> | Lapper". */
  private readonly pageTitles: ReadonlyArray<readonly [string, string]> = [
    ['/lapping-summaries', 'Lapping Summaries'],
    ['/scanners', 'Scanners'],
    ['/macros', 'Macros'],
    ['/fanuc-variables', 'Fanuc Variables'],
    ['/collector-tokens', 'Collector Tokens'],
    ['/dashboard/cell', 'Cell Live View'],
    ['/admin', 'Admin'],
    ['/login', 'Sign In'],
    ['/forgot-password', 'Forgot Password'],
    ['/reset-password', 'Reset Password'],
    ['/dashboard', 'Dashboard'],
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
    const prefix =
      exact ??
      this.pageTitles.find(([route]) => route !== '/' && cleanPath.startsWith(`${route}/`));
    this.browserTitle.setTitle(`${prefix?.[1] ?? 'Gear Apps'} | Lapper`);
  }

  get isLoginRoute(): boolean {
    return /^\/(login|forgot-password|reset-password)(?:[/?#]|$)/.test(this.router.url);
  }
}
