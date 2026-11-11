import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { GearToastHostComponent } from '@gearapps/manufacturing/frontend/util-common';

import { AppNavComponent } from './layout/app-nav/app-nav.component';

@Component({
  standalone: true,
  imports: [RouterOutlet, AppNavComponent, GearToastHostComponent],
  selector: 'gear-blade-tracking-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly browserTitle = inject(Title);

  title = 'blade-tracking';

  // Gear Apps browser tab identity v24
  private readonly pageTitles: ReadonlyArray<readonly [string, string]> = [
      ['/blades/cancel-last', 'Cancel Last Tray Transaction'],
      ['/blades/internal-movement', 'Internal Movement'],
      ['/blades/coater-shipments', 'Coater Shipments'],
      ['/blades/load-container', 'Load Coater Container'],
      ['/blades/receive-container', 'Receive From Coater'],
      ['/blades/tray-contents', 'Tray Contents'],
      ['/blades/all-inventory', 'Inventory Control Center'],
      ['/blades/scrap-blades', 'Scrap / Discarded'],
      ['/blades/inventory', 'Find Inventory'],
      ['/blades/locations', 'Blade Locations'],
      ['/blades/intake', 'Blade Intake'],
      ['/blades/grinding', 'Grinding'],
      ['/blades/body-shelves', 'Empty Body Shelves'],
      ['/admin', 'Admin'],
      ['/login', 'Sign In'],
      ['/forgot-password', 'Forgot Password'],
      ['/reset-password', 'Reset Password'],
      ['/blades', 'Dashboard'],
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
    const page = prefix?.[1] ?? 'MeshForge';
    this.browserTitle.setTitle(`${page} | Blade Tracking`);
  }

  get isLoginRoute(): boolean {
    return /^\/(login|forgot-password|reset-password)(?:[/?#]|$)/.test(this.router.url);
  }
}
