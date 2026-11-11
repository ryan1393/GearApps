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
} from '@dana/ui';

@Component({
  selector: 'gear-cutter-builder-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaKpiGridDirective, DanaKpiCardDirective, DanaPanelHeaderDirective, DanaPanelActionDirective, DanaTableShellDirective, DanaTableDirective, DanaCountBadgeDirective, DanaStatusBadgeDirective, DanaTableEmptyDirective, DanaPageHeaderComponent, DanaOperationCardComponent, DanaOperationGridDirective],
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
    );
  }

  ngOnInit(): void {
    this.refresh();
  }

  startGrinding(trayId: string, traySerial: string): void {
    this.loading = true;
    this.error = '';

    this.api.startGrinding(trayId).subscribe({
      next: () => this.refresh(),
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        this.error = cutterApiErrorText(
          err,
          `Could not start grinding for ${traySerial}.`,
        );
      },
    });
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
