import { Subject, takeUntil } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewChild, inject, OnDestroy } from '@angular/core';
import { GearToastService } from '@gearapps/manufacturing/frontend/util-common';
import { ILocation, ILocationTray, ITray } from '@gearapps/manufacturing/shared/util-types';
import { BladeTrackingApiService, InventoryLocationRow, InventoryTrayRow, apiErrorText } from '@gearapps/manufacturing/frontend/data-access-blade-tracking';
import { ScanMessage } from '../../models/scan-message';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import {
  DanaPageHeaderComponent,
  DanaDetailGridDirective, DanaDetailItemComponent,
} from '@dana/ui';

@Component({ selector: 'gear-internal-movement', standalone: true, imports: [CommonModule, FormsModule, ScanPanelComponent, DanaPageHeaderComponent, DanaDetailGridDirective, DanaDetailItemComponent], templateUrl: './internal-movement.component.html' })
export class InternalMovementComponent implements OnDestroy {
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
  get eligibleLocations(){const currentId=this.current?.location?.id;const q=this.locationSearch.trim().toLowerCase();return this.availableLocations.filter(x=>x.id!==currentId && this.locationEnabled(x) && (!q || (x.serial_number+' '+(x.description??'')+' '+(x.department??'')+' '+(x.location_type??'')).toLowerCase().includes(q)));}
  private locationEnabled(x:InventoryLocationRow):boolean{return (x as any).active!==false && (x as any).enabled!==false;}
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
    this.api.getAllLocations().pipe(takeUntil(this.destroyed$)).subscribe({next:rows=>{if(version===this.pickerVersion)this.availableLocations=rows;},error:e=>{if(version===this.pickerVersion){this.availableLocations=[];this.pickerError=apiErrorText(e,'Could not load destination locations.');}}});
  }
  chooseTray(s:string){if(s && !this.busy){this.selectedTraySerial=s;this.pickerOpen=false;this.scanTray(s);}} chooseLocation(s:string){if(s && !this.busy)this.scanLocation(s);} toggleTrayPicker(){this.pickerOpen=!this.pickerOpen;}
  busy = false;
  message: ScanMessage | null = null;

  scanTray(serial: string) {
    if (this.busy || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.tray = null; this.current = null;
    this.busy = true; this.message = null; this.destination = null;
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (tray) => {
        if (!tray.workflow_eligibility?.internal_movement) {
          this.busy = false; this.message = { tone: 'error', text: 'Only an in-house, unassigned tray with blades may be moved.' }; return;
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

  scanLocation(serial: string) {
    if (this.busy || !this.tray || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.destination = null;
    this.busy = true; this.message = null;
    this.api.scanLocation(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (location) => { this.destination = location; this.busy = false; this.locationScanner?.clearAndFocus(); this.message = { tone: 'info', text: `Destination ${location.serial_number} selected.` }; },
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
        this.message = null;
        this.toast.success(text, 'Tray moved');
        this.tray = null;
        this.current = null;
        this.destination = null;
        this.trayScanner?.clearAndFocus();
      },
      error: (err: HttpErrorResponse) => {
        const text = apiErrorText(err, 'Could not move tray.');
        this.toast.error(text, 'Move failed');
        this.fail(err, 'Could not move tray.');
      },
    });
  }
  private finishTray(current: ILocationTray | null) { this.current = current; this.busy = false; this.trayScanner?.clearAndFocus(); this.locationScanner?.focus(); this.message = { tone: 'success', text: current?.location ? `Tray ${this.tray?.serial_number} found at ${current.location.serial_number}.` : `Tray ${this.tray?.serial_number} has no current internal location.` }; }
  private fail(err: HttpErrorResponse, fallback: string, scanner?: ScanPanelComponent) { this.busy = false; this.message = { tone: 'error', text: apiErrorText(err, fallback) }; scanner?.select(); }
}
