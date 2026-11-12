import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { DanaPageHeaderComponent } from '@dana/ui';
import { filter } from 'rxjs';

import { AdminTab, DEFAULT_ADMIN_TAB, isAdminTab } from '../shared/admin-tabs';

/**
 * The Admin page: its header and section navigation. Each tab is a child route (/admin/<tab>)
 * that loads only its own data and stops loading when it is left.
 */
@Component({
  selector: 'gear-admin-users-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, DanaPageHeaderComponent],
  templateUrl: './frontend-feature-admin-users.component.html',
  styleUrls: ['./frontend-feature-admin-users.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrontendFeatureAdminUsersComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  activeTab: AdminTab = 'users';

  ngOnInit(): void {
    this.syncActiveTab();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncActiveTab());
  }

  /** A tab asked for by name (the mobile section list); unknown names are ignored. */
  openTabByName(tab: string): void {
    if (isAdminTab(tab)) this.setTab(tab);
  }

  setTab(tab: AdminTab): void {
    if (tab === this.activeTab) return;
    this.activeTab = tab;
    void this.router.navigate([tab], { relativeTo: this.route });
  }

  private syncActiveTab(): void {
    const tab = this.route.firstChild?.snapshot.routeConfig?.path;
    this.activeTab = isAdminTab(tab) ? tab : DEFAULT_ADMIN_TAB;
    this.cdr.markForCheck();
  }
}
