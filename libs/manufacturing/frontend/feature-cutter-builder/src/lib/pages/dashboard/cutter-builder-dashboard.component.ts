import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import {
  CutterBuilderApiService,
  CutterDashboardData,
  cutterApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import { canEditMeshForgeApp } from '@meshforge/manufacturing/shared/util-constants';
import { getDanaAppUrl } from '@meshforge/manufacturing/shared/dana-app-config';
import {
  DanaCountBadgeDirective,
  DanaDashboardGridComponent,
  DanaDashboardPanelComponent,
  DanaKpiCardDirective,
  DanaKpiGridDirective,
  DanaPanelActionDirective,
  DanaPanelHeaderDirective,
  DanaStatusBadgeDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaPageHeaderComponent,
  DanaOperationCardComponent,
  DanaOperationGridDirective,
  DanaToneDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-cutter-builder-dashboard',
  standalone: true,
  imports: [DanaToneDirective, CommonModule, RouterLink, DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaKpiGridDirective, DanaKpiCardDirective, DanaPanelHeaderDirective, DanaPanelActionDirective, DanaTableShellDirective, DanaTableDirective, DanaCountBadgeDirective, DanaStatusBadgeDirective, DanaTableEmptyDirective, DanaPageHeaderComponent, DanaOperationCardComponent, DanaOperationGridDirective],
  templateUrl: './cutter-builder-dashboard.component.html',
})
export class CutterBuilderDashboardComponent implements OnInit {
  private readonly session = inject(AuthSessionService);
  private readonly api = inject(CutterBuilderApiService);

  data: CutterDashboardData | null = null;
  loading = true;
  error = '';

  get canEdit(): boolean {
    const user = this.session.currentUser;
    return canEditMeshForgeApp(
      'CUTTER_BUILDER',
      user?.role,
      user?.departmentCode,
      user?.permissions,
    );
  }

  ngOnInit(): void {
    this.refresh();
  }

  /** Starting grinding is a Blade Tracking transaction: it needs that app's edit rights and a grinder. */
  get canEditBladeTracking(): boolean {
    const user = this.session.currentUser;
    return canEditMeshForgeApp(
      'BLADE_TRACKING',
      user?.role,
      user?.departmentCode,
      user?.permissions,
    );
  }

  /**
   * Opens Blade Tracking's Operations Station on Grinding with the tray already chosen, through the
   * same app URL the sidebar's Shared Apps link uses. The operator confirms the grinder there.
   */
  grindingStationUrl(traySerial: string): string {
    const query = new URLSearchParams({ op: 'grinding', tray: traySerial });
    return `${getDanaAppUrl('bladeTracking')}/blades/operations?${query.toString()}`;
  }

  refresh(): void {
    this.loading = true;
    this.error = '';

    this.api.getDashboard().subscribe({
      next: (data) => {
        this.data = data;
        this.loading = false;
      },
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        this.error = cutterApiErrorText(
          err,
          'Could not load Cutter Builder dashboard data.',
        );
      },
    });
  }
}
