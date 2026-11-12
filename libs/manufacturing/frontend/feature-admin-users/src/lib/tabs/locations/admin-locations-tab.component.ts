import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaToneDirective } from '@dana/ui';
import { HttpErrorResponse } from '@angular/common/http';
import {
  GearLabelPrinterPickerComponent,
  LabelPrinterChoices,
  LocationLabelFallback,
  LocationLabelInput,
  locationLabelFallbackReason,
  locationLabelFromResult,
  openLocationLabels,
} from '@meshforge/manufacturing/frontend/util-common';
import {
  CuttergrindNumberedShelfTag,
  CuttergrindRoughShelfTag,
  describeCuttergrindShelfPosition,
  locationPartTypeFromSerial,
  parseCuttergrindNumberedShelfTag,
  parseCuttergrindRoughShelfTag,
  parseSummaryShelfTag,
  SummaryShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';

import { AdminLocationRow, adminApiErrorText, PartSummaryRow, PartTypeRow } from '../../admin-api.service';
import { BulkLocationsComponent } from '../../bulk-locations/bulk-locations.component';
import { LocationEditorComponent } from '../../bulk-locations/location-editor.component';
import { allPages } from '../../shared/admin-data';
import { AdminFeedbackComponent } from '../../shared/admin-feedback.component';
import { AdminListStateComponent } from '../../shared/admin-list-state.component';
import { AdminTabBase } from '../../shared/admin-tab-base';

/**
 * Admin > Locations: create and edit one location (barcode, routing, Summary and part type),
 * print its tags and label. The mass description editor and bulk shelf panel sit above it.
 */
@Component({
  selector: 'gear-admin-locations-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaToneDirective, GearLabelPrinterPickerComponent, LocationEditorComponent, BulkLocationsComponent, AdminFeedbackComponent, AdminListStateComponent],
  templateUrl: './admin-locations-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
})
export class AdminLocationsTabComponent extends AdminTabBase implements OnInit {
  readonly locationsList = this.list<AdminLocationRow[]>([]);
  readonly partSummariesList = this.list<PartSummaryRow[]>([]);
  readonly partTypesList = this.list<PartTypeRow[]>([]);
  get locations(): AdminLocationRow[] { return this.locationsList.value(); }
  get partSummaries(): PartSummaryRow[] { return this.partSummariesList.value(); }
  get partTypes(): PartTypeRow[] { return this.partTypesList.value(); }

  locationSearch = '';
  /** Null until the card printer list has loaded. */
  cardPrintersSetUp: boolean | null = null;
  /** A label the card printer did not take, offered as a browser print. */
  labelFallback: LocationLabelFallback | null = null;
  editingLocationId: string | null = null;
  locationForm = this.emptyLocationForm();

  ngOnInit(): void {
    this.choiceLists = { 'Part Summaries': this.partSummariesList, 'Part Types': this.partTypesList };
    this.loadLocations();
    this.loadPartSummaries();
    this.loadPartTypes();
  }

  retryChoices(): void {
    if (this.partSummariesList.error() !== null) this.loadPartSummaries();
    if (this.partTypesList.error() !== null) this.loadPartTypes();
  }

  loadLocations(): void { this.locationsList.load(allPages((page) => this.api.listLocations(page, 50))); }
  loadPartSummaries(): void { this.partSummariesList.load(allPages((page) => this.api.listPartSummaries(page, 50))); }
  loadPartTypes(): void { this.partTypesList.load(this.api.listPartTypes()); }

  /** The bulk shelf panel or the mass editor changed locations: show them in the list. */
  reloadLocations(): void {
    this.loadLocations();
  }

  get filteredLocations(): AdminLocationRow[] {
    return this.locations.filter((location) =>
      this.matches(this.locationSearch, [
        location.serial_number,
        location.number,
        location.description,
        location.department,
        location.location_type,
        location.summary?.number,
        location.part_type?.code,
        location.tray_count,
        location.blade_count,
        location.enabled ? 'active' : 'inactive',
      ]),
    );
  }

  get locationShelfPreview() {
    return (
      parseCuttergrindRoughShelfTag(this.locationForm.serial_number) ??
      parseCuttergrindNumberedShelfTag(this.locationForm.serial_number) ??
      parseSummaryShelfTag(this.locationForm.serial_number)
    );
  }

  /** A Green Shed summary shelf names its Summary and part type in its barcode, so they are not chosen. */
  get locationContentsFromBarcode(): boolean {
    const serial = this.locationForm.serial_number;
    return !parseCuttergrindRoughShelfTag(serial) && !parseCuttergrindNumberedShelfTag(serial) && !!parseSummaryShelfTag(serial);
  }

  /**
   * One choice per Summary number, without revisions. The location keeps its current pick;
   * otherwise each number offers the revision a shelf barcode would choose (active, then newest).
   */
  get locationSummaryChoices(): PartSummaryRow[] {
    const selectedId = this.locationForm.summary_id;
    const preference = (summary: PartSummaryRow) => [summary.id === selectedId, summary.active] as const;
    const byNumber = new Map<string, PartSummaryRow>();
    for (const summary of this.partSummaries) {
      if (!summary.enabled && summary.id !== selectedId) continue;
      const key = summary.number.trim().toUpperCase();
      const current = byNumber.get(key);
      if (!current) {
        byNumber.set(key, summary);
        continue;
      }
      const [aSelected, aActive] = preference(summary);
      const [bSelected, bActive] = preference(current);
      const better =
        aSelected !== bSelected ? aSelected
        : aActive !== bActive ? aActive
        : summary.revision.localeCompare(current.revision, undefined, { numeric: true }) > 0;
      if (better) byNumber.set(key, summary);
    }
    return [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  }

  /**
   * RING or PINION when the barcode names it (the R or P in GSR, CGDR, CGFP...). The server always
   * sets the part type from it, so it is shown but not chosen.
   */
  get locationBarcodePartType(): string | null {
    return locationPartTypeFromSerial(this.locationForm.serial_number);
  }

  get locationPartTypeChoices(): PartTypeRow[] {
    return this.partTypes.filter((type) => type.code.trim().toUpperCase() !== 'GEARSET')
      .filter((type) => type.enabled || type.id === this.locationForm.part_type_id);
  }

  /** What the location's summary tag reads, such as 1.955FC-RING. Null until both are set. */
  locationSummaryTag(location: AdminLocationRow): string | null {
    return location.summary && location.part_type ? `${location.summary.number}-${location.part_type.code}`.toUpperCase() : null;
  }

  locationShelfDisplay(shelf: CuttergrindRoughShelfTag | CuttergrindNumberedShelfTag | SummaryShelfTag): string {
    if ('position' in shelf) return describeCuttergrindShelfPosition(shelf.position);
    return 'shelfNumber' in shelf
      ? `Shelf ${shelf.shelfNumber}`
      : `Summary ${shelf.summaryNumber}`;
  }

  saveLocation(): void {
    const serialNumber = this.locationForm.serial_number.trim().toUpperCase();
    const numberedShelf = parseCuttergrindRoughShelfTag(serialNumber) ?? parseCuttergrindNumberedShelfTag(serialNumber);
    const shelfTag = numberedShelf ? null : parseSummaryShelfTag(serialNumber);
    const number =
      numberedShelf?.shelfNumber ??
      shelfTag?.summaryNumber ??
      this.locationForm.number.trim();

    if (!serialNumber || !number) {
      this.error = 'Location barcode and location number are required.';
      return;
    }

    const payload = {
      serial_number: serialNumber,
      number,
      description: this.locationForm.description.trim() || null,
      department:
        numberedShelf?.department ?? shelfTag?.department ??
        (this.locationForm.department.trim().toUpperCase() || null),
      location_type:
        numberedShelf?.locationType ?? shelfTag?.locationType ??
        (this.locationForm.location_type.trim().toUpperCase() || 'INTERNAL'),
      enabled: this.locationForm.enabled,
      // A summary shelf's barcode sets both on the server; a barcode with R or P sets the part type.
      ...(shelfTag ? {} : { summary_id: this.locationForm.summary_id || null }),
      ...(shelfTag || locationPartTypeFromSerial(serialNumber) ? {} : { part_type_id: this.locationForm.part_type_id || null }),
    };

    const request = this.editingLocationId
      ? this.api.updateLocation(this.editingLocationId, payload)
      : this.api.createLocation(payload);

    this.runSave(
      request,
      this.editingLocationId ? 'Location updated.' : 'Location created.',
      () => {
        this.resetLocationForm();
        this.loadLocations();
      },
    );
  }

  beginEditLocation(location: AdminLocationRow): void {
    this.editingLocationId = location.id;
    this.locationForm = {
      serial_number: location.serial_number,
      number: location.number,
      description: location.description || '',
      department: location.department || '',
      location_type: location.location_type || 'INTERNAL',
      enabled: location.enabled,
      summary_id: location.summary_id || '',
      part_type_id: location.part_type_id || '',
    };
    this.clearNotice();
    this.focusEditor();
  }

  cancelLocationEdit(): void {
    this.resetLocationForm();
    this.clearNotice();
    this.cdr.markForCheck();
  }

  toggleLocationEnabled(location: AdminLocationRow, confirmed = false): void {
    const nextEnabled = !location.enabled;
    if (!nextEnabled && !confirmed) { this.askDisable(`location ${location.serial_number}`, 'Trays and cutters can no longer be placed there until it is enabled again.', () => this.toggleLocationEnabled(location, true)); return; }
    this.runSave(
      this.api.updateLocation(location.id, { enabled: nextEnabled }),
      `Location ${location.serial_number} ${nextEnabled ? 'enabled' : 'disabled'}.`,
      () => this.loadLocations(),
    );
  }

  /**
   * Prints the location's 4 x 6.5 label on the card printer chosen here (or the default card
   * printer). With no card printer set up it opens the browser print straight away; when the
   * printer does not take it, a notice offers the browser print instead.
   */
  printLocationLabel(location: AdminLocationRow): void {
    if (this.printingTagId) return;
    this.clearNotice();
    this.labelFallback = null;
    if (this.cardPrintersSetUp === false) {
      this.printLabelInBrowser(this.labelInput(location), 'No 4×6.5 card printer is set up, so the label opened in the browser to print.');
      return;
    }
    this.printingTagId = `${location.id}:label`;
    this.api.printLocationLabel(location.id).subscribe({
      next: (result) => {
        this.printingTagId = null;
        if (result.printed) {
          this.toast.success(`Location label for ${result.serial_number} sent to ${result.printer_name}.`, 'Label printed');
        } else {
          this.labelFallback = { serial: result.serial_number, reason: locationLabelFallbackReason(result), label: locationLabelFromResult(result) };
        }
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagId = null;
        this.labelFallback = {
          serial: location.serial_number,
          reason: adminApiErrorText(error) || 'The label could not be sent to the card printer.',
          label: this.labelInput(location),
        };
        this.cdr.markForCheck();
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
    if (!opened.ok) this.error = opened.reason;
    else if (message) this.message = message;
    this.cdr.markForCheck();
  }

  private labelInput(location: AdminLocationRow): LocationLabelInput {
    return {
      serial_number: location.serial_number,
      number: location.number,
      summary: location.summary?.number,
      part_type: location.part_type?.code,
      description: location.description,
      department: location.department,
    };
  }

  private emptyLocationForm() {
    return {
      serial_number: '',
      number: '',
      description: '',
      department: '',
      location_type: 'INTERNAL',
      enabled: true,
      summary_id: '',
      part_type_id: '',
    };
  }

  private resetLocationForm(): void {
    this.editingLocationId = null;
    this.locationForm = this.emptyLocationForm();
  }
}
