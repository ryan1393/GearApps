import { Subject, takeUntil } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewChild, inject, OnDestroy } from '@angular/core';
import { GearToastService, ScanMessage, OptionPickerComponent, PickerOption, ScanPanelComponent, StationStatusComponent } from '@meshforge/manufacturing/frontend/util-common';
import { ILocation, ILocationTray, ITray } from '@meshforge/manufacturing/shared/util-types';
import { BladeTrackingApiService, InventoryLocationRow, InventoryTrayRow, apiErrorText } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { autoShelfFor, trayMayMoveTo } from '../../shared/auto-shelf/auto-shelf';
import { StationOperation } from '../operations-station/operations-station.operations';
import { DanaDetailGridDirective, DanaDetailItemComponent, DanaPageHeaderComponent } from '@dana/ui';

@Component({ selector: 'gear-internal-movement', standalone: true, imports: [DanaPageHeaderComponent, CommonModule, FormsModule, ScanPanelComponent, StationStatusComponent, OptionPickerComponent, DanaDetailGridDirective, DanaDetailItemComponent], templateUrl: './internal-movement.component.html' })
export class InternalMovementComponent implements OnDestroy, StationOperation {
  private readonly destroyed$ = new Subject<void>();
  ngOnDestroy(): void { this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);
  @ViewChild('trayScanner') trayScanner?: ScanPanelComponent;
  @ViewChild('locationScanner') locationScanner?: ScanPanelComponent;
  tray: ITray | null = null;
  current: ILocationTray | null = null;
  destination: ILocation | null = null;
  availableTrays:InventoryTrayRow[]=[]; availableLocations:InventoryLocationRow[]=[]; selectedTraySerial=''; traySearch=''; locationSearch=''; trayLocationLabels:Record<string,string>={}; pickerOpen=false;
  get filteredTrays(){const q=this.traySearch.trim().toLowerCase();return q?this.availableTrays.filter(x=>(x.serial_number+' '+(this.trayLocationLabels[x.id]||'Unassigned')).toLowerCase().includes(q)):this.availableTrays;}
  get eligibleLocations(){const currentId=this.current?.location?.id;const q=this.locationSearch.trim().toLowerCase();return this.availableLocations.filter(x=>x.id!==currentId && x.enabled && (!q || (x.serial_number+' '+(x.description??'')+' '+(x.department??'')+' '+(x.location_type??'')).toLowerCase().includes(q)));}
  trayOptionLabel(tray:ITray){return tray.serial_number+' - Current: '+(this.trayLocationLabels[tray.id]||'Unassigned');}
  pickerError = '';
  private pickerVersion = 0;
  constructor(){this.refreshPickers();}
  refreshPickers(): void {
    const version = ++this.pickerVersion; this.pickerError = '';
    this.api.getWorkflowTrays('internal_movement').pipe(takeUntil(this.destroyed$)).subscribe({ next: rows => {
      if(version !== this.pickerVersion) return;
      this.availableTrays = rows;
      this.trayLocationLabels = Object.fromEntries(rows.map(t => [t.id, t.current_location?.serial_number ?? 'Unassigned']));
    }, error: e => { if(version === this.pickerVersion) { this.availableTrays = []; this.pickerError = apiErrorText(e, 'Could not load movable trays.'); } } });
    this.api.getAllLocations().pipe(takeUntil(this.destroyed$)).subscribe({next:rows=>{if(version===this.pickerVersion){this.availableLocations=rows;this.autoSelectShelf();}},error:e=>{if(version===this.pickerVersion){this.availableLocations=[];this.pickerError=apiErrorText(e,'Could not load destination locations.');}}});
  }
  chooseTray(s:string){if(s && !this.busy){this.selectedTraySerial=s;this.pickerOpen=false;this.scanTray(s);}} chooseLocation(s:string){if(s && !this.busy)this.scanLocation(s);} toggleTrayPicker(){this.pickerOpen=!this.pickerOpen;}
  busy = false;
  message: ScanMessage | null = null;
  /** The tray whose shelf was looked up automatically, so it is done once per scan and never overrides a choice. */
  private autoShelfTrayId: string | null = null;
  /** The destination was picked automatically: the only shelf holding the tray's Summary and part type. */
  autoSelected = false;

  get inProgress(): boolean { return Boolean(this.tray); }
  stationActivated(): void { if (!this.busy) this.refreshPickers(); }
  get trayOptions(): PickerOption[] {
    return this.filteredTrays.map((item) => ({ value: item.serial_number, cells: [item.serial_number, this.trayLocationLabels[item.id] || 'Unassigned', item.blade_count ?? 0] }));
  }
  get destinationOptions(): PickerOption[] {
    return this.eligibleLocations.map((location) => ({ value: location.serial_number, cells: [location.serial_number, location.description || location.location_type || 'Location'] }));
  }
  /** What the operator should do next, shown when there is no message. */
  get prompt(): string {
    if (this.busy) return 'Working…';
    if (!this.tray) return 'Scan the tray to move, or choose it from the list.';
    if (!this.destination) return `Scan the location tray ${this.tray.serial_number} is moving to.`;
    return `Check From and To, then tap Move Tray.`;
  }
  get moveBlockedReason(): string {
    return this.tray && !this.destination && !this.busy ? 'Scan or choose the destination first.' : '';
  }
  /** Start over with another tray. */
  clearTray(): void {
    if (this.busy) return;
    this.tray = null; this.current = null; this.destination = null; this.message = null; this.autoShelfTrayId = null; this.autoSelected = false;
  }

  /**
   * Selects the destination shelf by itself when exactly one shelf the tray may go to holds its
   * Summary and part type (the tray's current shelf counts). With two or more, the operator chooses.
   * The operator still checks From and To and taps Move Tray.
   */
  private autoSelectShelf(): void {
    const tray = this.tray;
    if (!tray || this.busy || this.destination || this.autoShelfTrayId === tray.id || !this.availableLocations.length) return;
    this.autoShelfTrayId = tray.id;
    const { shelf, matches } = autoShelfFor(this.availableLocations.filter((location) => trayMayMoveTo(location, tray)),
      tray.summary?.number, tray.part_type?.code);
    const holds = `Summary ${tray.summary?.number} ${tray.part_type?.code}`;
    if (matches.length > 1) {
      this.message = { tone: 'info', text: `${matches.length} shelves hold ${holds} (${matches.map((m) => m.serial_number).join(', ')}). Scan or choose the one tray ${tray.serial_number} goes to.` };
      return;
    }
    if (!shelf) return;
    if (shelf.id === this.current?.location?.id) {
      this.message = { tone: 'info', text: `Tray ${tray.serial_number} is already on ${shelf.serial_number}, the shelf for ${holds}.` };
      return;
    }
    this.scanLocation(shelf.serial_number, `Destination ${shelf.serial_number} selected automatically: the only shelf for ${holds}. Check it, then tap Move Tray.`);
  }

  scanTray(serial: string) {
    if (this.busy || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.tray = null; this.current = null; this.autoShelfTrayId = null; this.autoSelected = false;
    this.busy = true; this.message = null; this.destination = null;
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (tray) => {
        if (!tray.workflow_eligibility?.internal_movement) {
          this.busy = false; this.message = { tone: 'error', text: `Tray ${tray.serial_number} cannot be moved here. Only an in-house, unassigned tray with blades can be moved.` }; this.trayScanner?.select(); return;
        }
        this.tray = tray;
        this.api.getCurrentTrayLocation(tray.id).pipe(takeUntil(this.destroyed$)).subscribe({
          next: (current) => this.finishTray(current),
          error: (err: HttpErrorResponse) => err.status === 404 ? this.finishTray(null) : this.fail(err, 'Could not read tray location.'),
        });
      },
      error: (err: HttpErrorResponse) => this.fail(err, 'Tray not found.', this.trayScanner),
    });
  }

  /** `automatic`: the message when the shelf was selected automatically rather than scanned. */
  scanLocation(serial: string, automatic?: string) {
    if (this.busy || !this.tray || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.destination = null; this.autoSelected = false;
    this.busy = true; this.message = null;
    this.api.scanLocation(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (location) => { this.destination = location; this.autoSelected = Boolean(automatic); this.busy = false; this.locationScanner?.clearAndFocus(); this.message = { tone: 'info', text: automatic ?? `Destination ${location.serial_number} selected.` }; },
      error: (err: HttpErrorResponse) => this.fail(err, 'Location not found.', this.locationScanner),
    });
  }

  confirm() {
    this.r27Move();
  }

  r27Move() {
    if (!this.tray || !this.destination || this.busy) return;
    if (this.current?.location?.id === this.destination.id) {
      this.message = { tone: 'info', text: `Tray ${this.tray.serial_number} is already at ${this.destination.serial_number}.` };
      return;
    }
    const tray = this.tray;
    const destination = this.destination;
    const from = this.current?.location?.serial_number ?? 'Unassigned';
    this.busy = true;
    this.api.moveTray(tray.id, destination.id).pipe(takeUntil(this.destroyed$)).subscribe({
      next: () => {
        this.busy = false;
        this.refreshPickers();
        const text = `Tray ${tray.serial_number} moved from ${from} to ${destination.serial_number}.`;
        this.message = { tone: 'success', text };
        this.toast.success(text, 'Tray moved');
        this.tray = null;
        this.current = null;
        this.destination = null;
        this.autoShelfTrayId = null;
        this.autoSelected = false;
        this.trayScanner?.clearAndFocus();
      },
      error: (err: HttpErrorResponse) => this.fail(err, 'The tray was not moved. Try again, or scan the tray again.'),
    });
  }
  private finishTray(current: ILocationTray | null) { this.current = current; this.busy = false; this.trayScanner?.clearAndFocus(); this.locationScanner?.focus(); this.message = { tone: 'success', text: current?.location ? `Tray ${this.tray?.serial_number} found at ${current.location.serial_number}.` : `Tray ${this.tray?.serial_number} has no current internal location.` }; this.autoSelectShelf(); }
  private fail(err: HttpErrorResponse, fallback: string, scanner?: ScanPanelComponent) { this.busy = false; this.message = { tone: 'error', text: apiErrorText(err, fallback) }; scanner?.select(); }
}
