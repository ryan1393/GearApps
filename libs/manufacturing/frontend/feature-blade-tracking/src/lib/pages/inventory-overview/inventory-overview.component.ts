import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { GearLabelPrinterPickerComponent, GearToastService, announceAssetTagPrint } from '@meshforge/manufacturing/frontend/util-common';

import {
  AssetTagKind,
  BladeTrackingApiService,
  InventoryBladeRow,
  InventoryContainerRow,
  InventoryLocationRow,
  InventoryTrayRow,
  apiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import {
  DanaPageHeaderComponent,
  DanaSummaryCardDirective,
  DanaSummaryGridDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaToneDirective,
} from '@dana/ui';
import { IPaginationMeta } from '@meshforge/manufacturing/shared/util-types';

type InventoryTab = 'trays' | 'containers' | 'locations' | 'blades';

interface InventoryPageState<T> {
  rows: T[];
  meta: IPaginationMeta | null;
  loading: boolean;
  error: string;
}

@Component({
  selector: 'gear-inventory-overview',
  standalone: true,
  imports: [DanaToneDirective, 
    GearLabelPrinterPickerComponent,
    CommonModule,
    FormsModule,
    DanaSummaryGridDirective,
    DanaSummaryCardDirective,
    DanaTableShellDirective,
    DanaTableDirective,
    DanaTableEmptyDirective,
    DanaPageHeaderComponent,
  ],
  templateUrl: './inventory-overview.component.html',
})
export class InventoryOverviewComponent implements OnInit, OnDestroy {
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);
  private readonly destroyed$ = new Subject<void>();
  private readonly versions: Record<InventoryTab, number> = { trays: 0, containers: 0, locations: 0, blades: 0 };
  private operationError = '';

  activeTab: InventoryTab = 'trays';
  get error(): string { return this.operationError || this.stateFor(this.activeTab).error; }
  set error(value: string) { this.operationError = value; }
  printMessage = '';
  printTone: 'success' | 'warning' | 'info' = 'success';
  printingTagSerial: string | null = null;

  readonly searchTerms: Record<InventoryTab, string> = {
    trays: '',
    containers: '',
    locations: '',
    blades: '',
  };

  readonly appliedSearchTerms: Record<InventoryTab, string> = {
    trays: '',
    containers: '',
    locations: '',
    blades: '',
  };

  readonly inventoryTotals: Record<InventoryTab, number | null> = {
    trays: null,
    containers: null,
    locations: null,
    blades: null,
  };

  expandedTrayId: string | null = null;
  expandedContainerId: string | null = null;
  expandedLocationId: string | null = null;
  expandedContainerTrayId: string | null = null;
  expandedLocationTrayId: string | null = null;

  trays: InventoryPageState<InventoryTrayRow> = {
    rows: [],
    meta: null,
    loading: true,
    error: '',
  };

  containers: InventoryPageState<InventoryContainerRow> = {
    rows: [],
    meta: null,
    loading: true,
    error: '',
  };

  locations: InventoryPageState<InventoryLocationRow> = {
    rows: [],
    meta: null,
    loading: true,
    error: '',
  };

  blades: InventoryPageState<InventoryBladeRow> = {
    rows: [],
    meta: null,
    loading: true,
    error: '',
  };

  ngOnInit(): void {
    this.loadInitial();
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  get totalTrays(): number | string {
    return this.inventoryTotals.trays ?? (this.trays.loading ? '…' : '—');
  }

  get totalContainers(): number | string {
    return this.inventoryTotals.containers ?? (this.containers.loading ? '…' : '—');
  }

  get totalLocations(): number | string {
    return this.inventoryTotals.locations ?? (this.locations.loading ? '…' : '—');
  }

  get totalBlades(): number | string {
    return this.inventoryTotals.blades ?? (this.blades.loading ? '…' : '—');
  }

  get anyLoading(): boolean {
    return (
      this.trays.loading ||
      this.containers.loading ||
      this.locations.loading ||
      this.blades.loading
    );
  }

  get activeLoading(): boolean { return this.stateFor(this.activeTab).loading; }
  get activeLoadError(): string { return this.stateFor(this.activeTab).error; }

  get activeSearch(): string {
    return this.searchTerms[this.activeTab];
  }

  set activeSearch(value: string) {
    this.searchTerms[this.activeTab] = value;
  }

  get activeAppliedSearch(): string {
    return this.appliedSearchTerms[this.activeTab];
  }

  get activeTabLabel(): string {
    const labels: Record<InventoryTab, string> = {
      trays: 'trays',
      containers: 'containers',
      locations: 'locations',
      blades: 'blades',
    };
    return labels[this.activeTab];
  }

  get activeSearchPlaceholder(): string {
    const placeholders: Record<InventoryTab, string> = {
      trays: 'Tray serial, Summary, Part Type, or stage',
      containers: 'Container serial number',
      locations: 'Location tag, number, description, department, or type',
      blades: 'Blade serial, Summary, or Part Type',
    };
    return placeholders[this.activeTab];
  }

  get activeResultCount(): number {
    const state = this.stateFor(this.activeTab);
    return state.meta?.totalItems ?? 0;
  }

  setTab(tab: InventoryTab): void {
    this.activeTab = tab;
    this.error = '';
  }

  searchCurrentTab(): void {
    this.appliedSearchTerms[this.activeTab] = this.activeSearch.trim();
    this.loadActiveTab(1);
  }

  clearCurrentSearch(): void {
    this.searchTerms[this.activeTab] = '';
    this.appliedSearchTerms[this.activeTab] = '';
    this.loadActiveTab(1);
  }

  toggleTray(trayId: string): void {
    this.expandedTrayId = this.expandedTrayId === trayId ? null : trayId;
  }

  toggleContainer(containerId: string): void {
    this.expandedContainerId =
      this.expandedContainerId === containerId ? null : containerId;
    this.expandedContainerTrayId = null;
  }

  toggleContainerTray(trayId: string): void {
    this.expandedContainerTrayId =
      this.expandedContainerTrayId === trayId ? null : trayId;
  }

  toggleLocation(locationId: string): void {
    this.expandedLocationId =
      this.expandedLocationId === locationId ? null : locationId;
    this.expandedLocationTrayId = null;
  }

  toggleLocationTray(trayId: string): void {
    this.expandedLocationTrayId =
      this.expandedLocationTrayId === trayId ? null : trayId;
  }

  printTag(kind: AssetTagKind, recordId: string, serialNumber: string): void {
    if (this.printingTagSerial) return;
    this.error = '';
    this.printMessage = '';
    this.printingTagSerial = serialNumber;

    this.api.printAssetTag(kind, recordId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (result) => {
        this.printingTagSerial = null;
        if (!result.printed) {
          this.api.downloadAssetTagPrn(result);
        }
        const notice = announceAssetTagPrint(this.toast, result);
        this.printMessage = notice.text;
        this.printTone = notice.tone;
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagSerial = null;
        this.error = apiErrorText(error, `Could not print ${serialNumber} tag.`);
        this.toast.error(this.error, 'Tag not printed');
      },
    });
  }

  refresh(): void {
    this.loadActiveTab(this.stateFor(this.activeTab).meta?.page ?? 1);
  }

  loadTrays(page: number): void {
    if (page < 1) return;
    const version = ++this.versions.trays;
    this.error = '';
    this.trays.error = '';
    this.expandedTrayId = null;
    this.trays.loading = true;

    const search = this.appliedSearchTerms.trays;
    this.api.getTrays(page, 50, search).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (response) => {
        if (version !== this.versions.trays) return;
        this.trays = {
          rows: response.data,
          meta: response.meta,
          loading: false,
          error: '',
        };
        if (!search) this.inventoryTotals.trays = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.versions.trays) return;
        this.trays.loading = false;
        this.trays.error = apiErrorText(error, 'Could not load trays.');
      },
    });
  }

  loadContainers(page: number): void {
    if (page < 1) return;
    const version = ++this.versions.containers;
    this.error = '';
    this.containers.error = '';
    this.expandedContainerId = null;
    this.expandedContainerTrayId = null;
    this.containers.loading = true;

    const search = this.appliedSearchTerms.containers;
    this.api.getContainers(page, 50, search).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (response) => {
        if (version !== this.versions.containers) return;
        this.containers = {
          rows: response.data,
          meta: response.meta,
          loading: false,
          error: '',
        };
        if (!search) this.inventoryTotals.containers = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.versions.containers) return;
        this.containers.loading = false;
        this.containers.error = apiErrorText(error, 'Could not load containers.');
      },
    });
  }

  loadLocations(page: number): void {
    if (page < 1) return;
    const version = ++this.versions.locations;
    this.error = '';
    this.locations.error = '';
    this.expandedLocationId = null;
    this.expandedLocationTrayId = null;
    this.locations.loading = true;

    const search = this.appliedSearchTerms.locations;
    this.api.getLocations(page, 50, search).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (response) => {
        if (version !== this.versions.locations) return;
        this.locations = {
          rows: response.data,
          meta: response.meta,
          loading: false,
          error: '',
        };
        if (!search) this.inventoryTotals.locations = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.versions.locations) return;
        this.locations.loading = false;
        this.locations.error = apiErrorText(error, 'Could not load locations.');
      },
    });
  }

  loadBlades(page: number): void {
    if (page < 1) return;
    const version = ++this.versions.blades;
    this.error = '';
    this.blades.error = '';
    this.blades.loading = true;

    const search = this.appliedSearchTerms.blades;
    this.api.getBlades(page, 50, search).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (response) => {
        if (version !== this.versions.blades) return;
        this.blades = {
          rows: response.data,
          meta: response.meta,
          loading: false,
          error: '',
        };
        if (!search) this.inventoryTotals.blades = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.versions.blades) return;
        this.blades.loading = false;
        this.blades.error = apiErrorText(error, 'Could not load blades.');
      },
    });
  }

  private loadActiveTab(page: number): void {
    if (this.activeTab === 'trays') {
      this.loadTrays(page);
    } else if (this.activeTab === 'containers') {
      this.loadContainers(page);
    } else if (this.activeTab === 'locations') {
      this.loadLocations(page);
    } else {
      this.loadBlades(page);
    }
  }

  private stateFor(tab: InventoryTab): InventoryPageState<unknown> {
    if (tab === 'trays') return this.trays;
    if (tab === 'containers') return this.containers;
    if (tab === 'locations') return this.locations;
    return this.blades;
  }

  private loadInitial(): void {
    // Each inventory type loads independently: one failed or restricted lookup must
    // not discard the other successful tabs or leave their operators waiting.
    this.loadTrays(1);
    this.loadContainers(1);
    this.loadLocations(1);
    this.loadBlades(1);
  }
}
