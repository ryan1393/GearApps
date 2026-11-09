import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import {
  AssetTagKind,
  BladeTrackingApiService,
  InventoryBladeRow,
  InventoryContainerRow,
  InventoryLocationRow,
  InventoryTrayRow,
  apiErrorText,
} from '@gearapps/manufacturing/frontend/data-access-blade-tracking';
import {
  DanaPageHeaderComponent,
  DanaSummaryCardDirective,
  DanaSummaryGridDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import { IPaginationMeta } from '@gearapps/manufacturing/shared/util-types';

type InventoryTab = 'trays' | 'containers' | 'locations' | 'blades';

interface InventoryPageState<T> {
  rows: T[];
  meta: IPaginationMeta | null;
  loading: boolean;
}

@Component({
  selector: 'gear-inventory-overview',
  standalone: true,
  imports: [
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
export class InventoryOverviewComponent implements OnInit {
  private readonly api = inject(BladeTrackingApiService);

  activeTab: InventoryTab = 'trays';
  error = '';
  printMessage = '';
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

  readonly inventoryTotals: Record<InventoryTab, number> = {
    trays: 0,
    containers: 0,
    locations: 0,
    blades: 0,
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
  };

  containers: InventoryPageState<InventoryContainerRow> = {
    rows: [],
    meta: null,
    loading: true,
  };

  locations: InventoryPageState<InventoryLocationRow> = {
    rows: [],
    meta: null,
    loading: true,
  };

  blades: InventoryPageState<InventoryBladeRow> = {
    rows: [],
    meta: null,
    loading: true,
  };

  ngOnInit(): void {
    this.loadInitial();
  }

  get totalTrays(): number {
    return this.inventoryTotals.trays;
  }

  get totalContainers(): number {
    return this.inventoryTotals.containers;
  }

  get totalLocations(): number {
    return this.inventoryTotals.locations;
  }

  get totalBlades(): number {
    return this.inventoryTotals.blades;
  }

  get anyLoading(): boolean {
    return (
      this.trays.loading ||
      this.containers.loading ||
      this.locations.loading ||
      this.blades.loading
    );
  }

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

    this.api.printAssetTag(kind, recordId).subscribe({
      next: (result) => {
        this.printingTagSerial = null;
        if (!result.printed) {
          this.api.downloadAssetTagPrn(result);
        }
        this.printMessage = result.printed
          ? `${result.serial_number} tag sent to the IPL printer.`
          : `${result.message} ${result.file_name} downloaded.`;
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagSerial = null;
        this.error = apiErrorText(error, `Could not print ${serialNumber} tag.`);
      },
    });
  }

  refresh(): void {
    this.loadActiveTab(this.stateFor(this.activeTab).meta?.page ?? 1);
  }

  loadTrays(page: number): void {
    if (page < 1) return;
    this.error = '';
    this.expandedTrayId = null;
    this.trays.loading = true;

    const search = this.appliedSearchTerms.trays;
    this.api.getTrays(page, 50, search).subscribe({
      next: (response) => {
        this.trays = {
          rows: response.data,
          meta: response.meta,
          loading: false,
        };
        if (!search) this.inventoryTotals.trays = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        this.trays.loading = false;
        this.error = apiErrorText(error, 'Could not load trays.');
      },
    });
  }

  loadContainers(page: number): void {
    if (page < 1) return;
    this.error = '';
    this.expandedContainerId = null;
    this.expandedContainerTrayId = null;
    this.containers.loading = true;

    const search = this.appliedSearchTerms.containers;
    this.api.getContainers(page, 50, search).subscribe({
      next: (response) => {
        this.containers = {
          rows: response.data,
          meta: response.meta,
          loading: false,
        };
        if (!search) this.inventoryTotals.containers = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        this.containers.loading = false;
        this.error = apiErrorText(error, 'Could not load containers.');
      },
    });
  }

  loadLocations(page: number): void {
    if (page < 1) return;
    this.error = '';
    this.expandedLocationId = null;
    this.expandedLocationTrayId = null;
    this.locations.loading = true;

    const search = this.appliedSearchTerms.locations;
    this.api.getLocations(page, 50, search).subscribe({
      next: (response) => {
        this.locations = {
          rows: response.data,
          meta: response.meta,
          loading: false,
        };
        if (!search) this.inventoryTotals.locations = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        this.locations.loading = false;
        this.error = apiErrorText(error, 'Could not load locations.');
      },
    });
  }

  loadBlades(page: number): void {
    if (page < 1) return;
    this.error = '';
    this.blades.loading = true;

    const search = this.appliedSearchTerms.blades;
    this.api.getBlades(page, 50, search).subscribe({
      next: (response) => {
        this.blades = {
          rows: response.data,
          meta: response.meta,
          loading: false,
        };
        if (!search) this.inventoryTotals.blades = response.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        this.blades.loading = false;
        this.error = apiErrorText(error, 'Could not load blades.');
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
    this.error = '';

    forkJoin({
      trays: this.api.getTrays(1, 50),
      containers: this.api.getContainers(1, 50),
      locations: this.api.getLocations(1, 50),
      blades: this.api.getBlades(1, 50),
    }).subscribe({
      next: ({ trays, containers, locations, blades }) => {
        this.trays = { rows: trays.data, meta: trays.meta, loading: false };
        this.containers = {
          rows: containers.data,
          meta: containers.meta,
          loading: false,
        };
        this.locations = {
          rows: locations.data,
          meta: locations.meta,
          loading: false,
        };
        this.blades = { rows: blades.data, meta: blades.meta, loading: false };

        this.inventoryTotals.trays = trays.meta.totalItems;
        this.inventoryTotals.containers = containers.meta.totalItems;
        this.inventoryTotals.locations = locations.meta.totalItems;
        this.inventoryTotals.blades = blades.meta.totalItems;
      },
      error: (error: HttpErrorResponse) => {
        this.trays.loading = false;
        this.containers.loading = false;
        this.locations.loading = false;
        this.blades.loading = false;
        this.error = apiErrorText(
          error,
          'Could not load Blade Tracking inventory.',
        );
      },
    });
  }
}
