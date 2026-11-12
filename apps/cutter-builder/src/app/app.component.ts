import { Component, inject } from '@angular/core';
import { DanaThemeToggleComponent } from '@dana/ui';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { GearToastHostComponent } from '@meshforge/manufacturing/frontend/util-common';
import { CutterBuilderNavComponent } from './layout/cutter-builder-nav/cutter-builder-nav.component';

@Component({
  standalone: true,
  imports: [DanaThemeToggleComponent, RouterOutlet, CutterBuilderNavComponent, GearToastHostComponent],
  selector: 'gear-cutter-builder-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly browserTitle = inject(Title);

  title = 'cutter-builder';

  // MeshForge browser tab identity v24
  private readonly pageTitles: ReadonlyArray<readonly [string, string]> = [
      ['/cutter-builder/cancel-last', 'Cancel Last Build'],
      ['/cutter-builder/teardown', 'Tear Down Cutter'],
      ['/cutter-builder/lookup', 'Build Lookup'],
      ['/cutter-builder/build', 'Build Cutter'],
      ['/admin', 'Admin'],
      ['/login', 'Sign In'],
      ['/forgot-password', 'Forgot Password'],
      ['/reset-password', 'Reset Password'],
      ['/cutter-builder', 'Dashboard'],
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
    this.browserTitle.setTitle(`${page} | Cutter Builder`);
  }

  get isLoginRoute(): boolean {
    return /^\/(login|forgot-password|reset-password)(?:[/?#]|$)/.test(this.router.url);
  }
}
