import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  GearLabelPrinterPickerComponent,
  GearToastService,
  LabelPrinterChoices,
  LocationLabelFallback,
  LocationLabelInput,
  announceAssetTagPrint,
  locationLabelFallbackReason,
  locationLabelFromResult,
  openLocationLabels,
} from '@meshforge/manufacturing/frontend/util-common';

import {
  AssetTagKind,
  BladeTrackingApiService,
  InventoryLocationRow,
  apiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import {
  DanaSummaryCardDirective,
  DanaSummaryGridDirective,
  DanaPageHeaderComponent,
  DanaButtonDirective,
  DanaAlertDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaToneDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-blade-locations',
  standalone: true,
  imports: [DanaToneDirective, GearLabelPrinterPickerComponent, CommonModule, FormsModule, DanaSummaryGridDirective, DanaSummaryCardDirective, DanaPageHeaderComponent, DanaButtonDirective, DanaAlertDirective, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],
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
  /** Null until the card printer list has loaded. */
  cardPrintersSetUp: boolean | null = null;
  /** A label the card printer did not take, offered as a browser print. */
  labelFallback: LocationLabelFallback | null = null;
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
        location.summary?.number,
        location.part_type?.code,
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


  /** What the location's summary tag reads, such as 1.955FC-RING. Null until both are set in Admin. */
  summaryTag(location: InventoryLocationRow): string | null {
    return location.summary && location.part_type ? `${location.summary.number}-${location.part_type.code}`.toUpperCase() : null;
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

  /**
   * Prints the location's 4 x 6.5 label on the card printer chosen here (or the default card
   * printer). With no card printer set up it opens the browser print straight away; when the
   * printer does not take it, a notice offers the browser print instead.
   */
  printLocationLabel(location: InventoryLocationRow): void {
    if (this.printingTagSerial) return;
    this.error = '';
    this.printMessage = '';
    this.labelFallback = null;
    if (this.cardPrintersSetUp === false) {
      this.printLabelInBrowser(this.labelInput(location), 'No 4×6.5 card printer is set up, so the label opened in the browser to print.');
      return;
    }
    this.printingTagSerial = `${location.serial_number}:label`;
    this.api.printLocationLabel(location.id).subscribe({
      next: (result) => {
        this.printingTagSerial = null;
        if (result.printed) {
          this.printMessage = `Location label for ${result.serial_number} sent to ${result.printer_name}.`;
          this.printTone = 'success';
          this.toast.success(this.printMessage, 'Label printed');
        } else {
          this.labelFallback = { serial: result.serial_number, reason: locationLabelFallbackReason(result), label: locationLabelFromResult(result) };
        }
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagSerial = null;
        this.labelFallback = {
          serial: location.serial_number,
          reason: apiErrorText(error, 'The label could not be sent to the card printer.'),
          label: this.labelInput(location),
        };
      },
    });
  }

  /** The card printers found for "Print 4×6.5 labels to"; with none, labels print from the browser. */
  cardPrintersLoaded(choices: LabelPrinterChoices): void {
    this.cardPrintersSetUp = choices.printers.length > 0 || Boolean(choices.default_printer_name);
  }

  /** "Print in browser" on the notice: opens the 4 x 6.5 browser print for the label that was not printed. */
  printFallbackInBrowser(): void {
    const fallback = this.labelFallback;
    if (!fallback) return;
    this.labelFallback = null;
    this.printLabelInBrowser(fallback.label, '');
  }

  dismissLabelFallback(): void {
    this.labelFallback = null;
  }

  private printLabelInBrowser(label: LocationLabelInput, message: string): void {
    const opened = openLocationLabels([label]);
    if (!opened.ok) {
      this.error = opened.reason;
      this.toast.error(opened.reason, 'Label not printed');
    } else if (message) {
      this.printMessage = message;
      this.printTone = 'info';
    }
  }

  private labelInput(location: InventoryLocationRow): LocationLabelInput {
    return {
      serial_number: location.serial_number,
      number: location.number,
      summary: location.summary?.number,
      part_type: location.part_type?.code,
      description: location.description,
      department: location.department,
    };
  }

  refresh(): void {
    this.loading = true;
    this.error = '';
    this.expandedLocationId = null;
    this.expandedTrayId = null;
    this.loadLocationsPage(1, [], ++this.locationsVersion);
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

  /** The refresh that owns the list; pages from an earlier refresh are dropped. */
  private locationsVersion = 0;

  private loadLocationsPage(
    page: number,
    accumulated: InventoryLocationRow[],
    version: number,
  ): void {
    this.api.getLocations(page, 50).subscribe({
      next: (response) => {
        if (version !== this.locationsVersion) return;
        const combined = [...accumulated, ...response.data];
        if (response.meta.hasNextPage) {
          this.loadLocationsPage(page + 1, combined, version);
          return;
        }

        this.rows = combined;
        this.loading = false;
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.locationsVersion) return;
        this.loading = false;
        this.error = apiErrorText(
          error,
          'Could not load Blade Tracking locations and tray contents.',
        );
      },
    });
  }
}
