import { Subject, takeUntil, interval } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import {
  BladeTrackingApiService,
  BladeTrackingDashboardData,
  InventoryAvailabilityData,
  apiErrorText,
} from '@libs/frontend/data-access-blade-tracking';
import { AuthSessionService } from '@libs/frontend/data-access-user';
import { canEditGearApp } from '@libs/shared/util-constants';
import { IPartSummary, IPartType } from '@libs/shared/util-types';
import {
  DanaCountBadgeDirective,
  DanaDashboardGridComponent,
  DanaDashboardPanelComponent,
  DanaEmptyStateDirective,
  DanaKpiCardDirective,
  DanaKpiGridDirective,
  DanaLoadingStateDirective,
  DanaPanelActionDirective,
  DanaPanelHeaderDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaPageHeaderComponent,
  DanaOperationCardComponent,
  DanaOperationGridDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-blade-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaKpiGridDirective, DanaKpiCardDirective, DanaPanelHeaderDirective, DanaPanelActionDirective, DanaTableShellDirective, DanaTableDirective, DanaCountBadgeDirective, DanaLoadingStateDirective, DanaEmptyStateDirective, DanaTableEmptyDirective, DanaPageHeaderComponent, DanaOperationCardComponent, DanaOperationGridDirective],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private availabilityVersion = 0;
  lookupsError = '';
  private readonly session = inject(AuthSessionService);
  private readonly api = inject(BladeTrackingApiService);

  scanValue = '';
  dashboard: BladeTrackingDashboardData | null = null;
  loading = true;
  error = '';
  availability: InventoryAvailabilityData | null = null;
  availabilityLoading = false;
  availabilityError = '';
  summaries: IPartSummary[] = [];
  partTypes: IPartType[] = [];
  selectedSummaryId = '';
  selectedPartTypeId = '';
  selectedTrayStageCode = '';
  selectedTrayStageName = '';
  traySearch = '';
  trayPage = 1;
  readonly trayPageSize = 20;
  private availabilitySelectionKey = '';

  get selectedTrayStage() {
    return this.availability?.stages.find(stage => stage.code === this.selectedTrayStageCode) ?? null;
  }

  get trayListSupported(): boolean {
    const stage = this.selectedTrayStage;
    return !!stage && Array.isArray(stage.trays) && stage.trays.length === stage.tray_count;
  }

  get filteredStageTrays() {
    if (!this.trayListSupported) return [];
    const search = this.traySearch.trim().toLowerCase();
    const rows = this.selectedTrayStage!.trays;
    return search ? rows.filter(tray => [tray.serial_number, tray.part_type_code, tray.location_serial, tray.container_serial]
      .some(value => (value ?? '').toLowerCase().includes(search))) : rows;
  }

  get trayPageCount(): number { return Math.max(1, Math.ceil(this.filteredStageTrays.length / this.trayPageSize)); }
  get displayedTrays() { return this.filteredStageTrays.slice((this.trayPage - 1) * this.trayPageSize, this.trayPage * this.trayPageSize); }
  get trayRangeStart(): number { return this.filteredStageTrays.length ? (this.trayPage - 1) * this.trayPageSize + 1 : 0; }
  get trayRangeEnd(): number { return Math.min(this.trayPage * this.trayPageSize, this.filteredStageTrays.length); }

  showStageTrays(code: string): void {
    if (this.availabilityLoading) return;
    const stage = this.availability?.stages.find(item => item.code === code);
    if (!stage) return;
    this.selectedTrayStageCode = stage.code;
    this.selectedTrayStageName = stage.name;
    this.traySearch = ''; this.trayPage = 1;
  }

  closeStageTrays(): void { this.selectedTrayStageCode = ''; this.selectedTrayStageName = ''; this.traySearch = ''; this.trayPage = 1; }
  resetTrayPage(): void { this.trayPage = 1; }
  changeTrayPage(delta: number): void { this.trayPage = Math.max(1, Math.min(this.trayPageCount, this.trayPage + delta)); }
  trackStage(_index: number, stage: { code: string }): string { return stage.code; }
  trackTray(_index: number, tray: { id: string }): string { return tray.id; }

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    this.refreshDashboard();
    this.api.getPartSummaries().pipe(takeUntil(this.destroyed$)).subscribe({ next: rows => this.summaries = rows.filter(row => row.enabled), error: error => this.lookupsError = apiErrorText(error, 'Could not load Part Summaries. Reload this page to retry.') });
    this.api.getPartTypes().pipe(takeUntil(this.destroyed$)).subscribe({ next: rows => this.partTypes = rows.filter(row => row.enabled && ['RING','PINION'].includes(row.code)), error: error => this.lookupsError = apiErrorText(error, 'Could not load Part Types. Reload this page to retry.') });
    interval(30000).pipe(takeUntil(this.destroyed$)).subscribe(() => {
      if (document.visibilityState === 'visible' && this.selectedSummaryId && !this.availabilityLoading) this.refreshAvailability();
    });
  }

  ngOnDestroy(): void { this.availabilityVersion++; this.destroyed$.next(); this.destroyed$.complete(); }

  get canEdit(): boolean {
    const user = this.session.currentUser;
    return canEditGearApp(
      'BLADE_TRACKING',
      user?.role,
      user?.departmentCode,
    );
  }

  refreshDashboard(): void {
    this.loading = true;
    this.error = '';

    this.api.getDashboard().pipe(takeUntil(this.destroyed$)).subscribe({
      next: (dashboard) => {
        this.dashboard = dashboard;
        this.loading = false;
      },
      error: (error: HttpErrorResponse) => {
        this.loading = false;
        this.error = apiErrorText(
          error,
          'Could not load Blade Tracking dashboard data.',
        );
      },
    });
  }


  refreshAvailability(): void {
    const version = ++this.availabilityVersion;
    const selectionKey = this.selectedSummaryId + '/' + this.selectedPartTypeId;
    if (selectionKey !== this.availabilitySelectionKey) {
      this.closeStageTrays(); this.availability = null;
      this.availabilitySelectionKey = selectionKey;
    }
    this.availabilityError = ''; this.availabilityLoading = false;
    if (!this.selectedSummaryId) return;
    this.availabilityLoading = true;
    this.api.getInventoryAvailability(this.selectedSummaryId, this.selectedPartTypeId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: value => {
        if (version !== this.availabilityVersion) return;
        if (value.summary_id !== this.selectedSummaryId || (value.part_type_id ?? '') !== this.selectedPartTypeId) {
          this.availability = null; this.availabilityLoading = false;
          this.availabilityError = 'Availability selection changed. Refresh this selection before opening trays.';
          return;
        }
        this.availability = value; this.availabilityLoading = false;
        this.trayPage = Math.min(this.trayPage, this.trayPageCount);
      },
      error: error => { if (version !== this.availabilityVersion) return; this.availability = null; this.availabilityLoading = false; this.availabilityError = apiErrorText(error, 'Could not load inventory availability.'); },
    });
  }

  quickScan(): void {
    const serial = this.scanValue.trim();
    if (!serial) return;
    void this.router.navigate(['/blades/inventory'], {
      queryParams: { serial },
    });
    this.scanValue = '';
  }
}
