import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GearToastService, announceAssetTagPrint } from '@gearapps/manufacturing/frontend/util-common';

import {
  AssetTagKind,
  BladeTrackingApiService,
  InventoryLocationRow,
  apiErrorText,
} from '@gearapps/manufacturing/frontend/data-access-blade-tracking';
import {
  DanaSummaryCardDirective,
  DanaSummaryGridDirective,
  DanaPageHeaderComponent,
  DanaButtonDirective,
  DanaAlertDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-blade-locations',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaSummaryGridDirective, DanaSummaryCardDirective, DanaPageHeaderComponent, DanaButtonDirective, DanaAlertDirective, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],
  templateUrl: './blade-locations.component.html',
})
export class BladeLocationsComponent implements OnInit {
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);

  rows: InventoryLocationRow[] = [];
  loading = true;
  error = '';
  printMessage = '';
  printTone: 'success' | 'warning' | 'info' = 'success';
  printingTagSerial: string | null = null;
  searchValue = '';
  expandedLocationId: string | null = null;
  expandedTrayId: string | null = null;

  ngOnInit(): void {
    this.refresh();
  }

  get filteredLocations(): InventoryLocationRow[] {
    const search = this.searchValue.trim().toUpperCase();
    if (!search) return this.rows;

    return this.rows.filter((location) => {
      const locationText = [
        location.serial_number,
        location.number,
        location.description,
        location.department,
        location.location_type,
      ]
        .filter(Boolean)
        .join(' ')
        .toUpperCase();

      if (locationText.includes(search)) return true;

      return location.trays.some((tray) => {
        const trayText = [
          tray.serial_number,
          tray.summary_number,
          tray.part_type_code,
          tray.stage_code,
          tray.stage_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toUpperCase();

        if (trayText.includes(search)) return true;

        return tray.blades.some((blade) =>
          [
            blade.serial_number,
            blade.status,
            blade.summary_number,
            blade.part_type_code,
          ]
            .filter(Boolean)
            .join(' ')
            .toUpperCase()
            .includes(search),
        );
      });
    });
  }

  get totalLocations(): number {
    return this.rows.length;
  }

  get totalTrays(): number {
    return this.rows.reduce((total, location) => total + location.tray_count, 0);
  }

  get totalBlades(): number {
    return this.rows.reduce((total, location) => total + location.blade_count, 0);
  }

  get emptyLocations(): number {
    return this.rows.filter((location) => location.tray_count === 0).length;
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
    this.loading = true;
    this.error = '';
    this.expandedLocationId = null;
    this.expandedTrayId = null;
    this.loadLocationsPage(1, []);
  }

  clearSearch(): void {
    this.searchValue = '';
  }

  toggleLocation(locationId: string): void {
    if (this.expandedLocationId === locationId) {
      this.expandedLocationId = null;
      this.expandedTrayId = null;
      return;
    }

    this.expandedLocationId = locationId;
    this.expandedTrayId = null;
  }

  toggleTray(trayId: string): void {
    this.expandedTrayId = this.expandedTrayId === trayId ? null : trayId;
  }

  isGreenshedCutterShelf(location: InventoryLocationRow): boolean {
    return (
      location.department === 'GREENSHED' &&
      location.location_type === 'SHELF'
    );
  }

  readable(value: string | null | undefined): string {
    if (!value) return '—';
    return value.replace(/_/g, ' ');
  }

  private loadLocationsPage(
    page: number,
    accumulated: InventoryLocationRow[],
  ): void {
    this.api.getLocations(page, 50).subscribe({
      next: (response) => {
        const combined = [...accumulated, ...response.data];
        if (response.meta.hasNextPage) {
          this.loadLocationsPage(page + 1, combined);
          return;
        }

        this.rows = combined;
        this.loading = false;
      },
      error: (error: HttpErrorResponse) => {
        this.loading = false;
        this.error = apiErrorText(
          error,
          'Could not load Blade Tracking locations and tray contents.',
        );
      },
    });
  }
}
