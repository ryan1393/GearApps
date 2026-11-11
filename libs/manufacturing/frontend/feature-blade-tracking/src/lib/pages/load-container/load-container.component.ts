import { Subject, takeUntil } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, ViewChild, inject } from '@angular/core';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { IContainer } from '@meshforge/manufacturing/shared/util-types';
import {
  BladeTrackingApiService,
  InventoryContainerRow,
  InventoryContainedTrayRow,
  InventoryTrayRow,
  apiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { ScanMessage } from '../../models/scan-message';
import { OptionPickerComponent, PickerOption } from '../../shared/option-picker/option-picker.component';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import { StationStatusComponent } from '../../shared/station-status/station-status.component';
import { StationOperation } from '../operations-station/operations-station.operations';

@Component({
  selector: 'gear-load-container',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, ScanPanelComponent, StationStatusComponent, OptionPickerComponent],
  templateUrl: './load-container.component.html',
})
export class LoadContainerComponent implements OnDestroy, StationOperation {
  private readonly destroyed$ = new Subject<void>();
  ngOnDestroy(): void { this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);
  @ViewChild('containerScanner') containerScanner?: ScanPanelComponent;
  @ViewChild('trayScanner') trayScanner?: ScanPanelComponent;
  container: IContainer | null = null;
  trays: Array<Pick<InventoryContainedTrayRow, 'id' | 'serial_number' | 'blade_count'>> = [];
  availableContainers:InventoryContainerRow[]=[]; availableTrays:InventoryTrayRow[]=[]; selectedContainerSerial=''; selectedTraySerial=''; containerSearch=''; traySearch='';
  get filteredContainers(){const q=this.containerSearch.trim().toLowerCase();return q?this.availableContainers.filter(x=>x.serial_number.toLowerCase().includes(q)):this.availableContainers;} get filteredTrays(){const q=this.traySearch.trim().toLowerCase();return q?this.availableTrays.filter(x=>x.serial_number.toLowerCase().includes(q)):this.availableTrays;}
  pickerError = '';
  private pickerVersion = 0;
  constructor(){this.refreshPickers();}
  refreshPickers(): void {
    const version = ++this.pickerVersion; this.pickerError = '';
    this.api.getWorkflowContainers('load').pipe(takeUntil(this.destroyed$)).subscribe({ next: rows => { if(version === this.pickerVersion) this.availableContainers = rows; }, error: e => { if(version === this.pickerVersion) { this.availableContainers = []; this.pickerError = apiErrorText(e, 'Could not load available containers.'); } } });
    this.api.getWorkflowTrays('coater_load').pipe(takeUntil(this.destroyed$)).subscribe({ next: rows => { if(version === this.pickerVersion) this.availableTrays = rows; }, error: e => { if(version === this.pickerVersion) { this.availableTrays = []; this.pickerError = apiErrorText(e, 'Could not load ready-for-coating trays.'); } } });
  }
  chooseContainer(s:string){if(s)this.scanContainer(s);else if(!this.busy){this.container=null;this.trays=[];}} chooseTray(s:string){if(s)this.scanTray(s);}
  busy = false;
  message: ScanMessage | null = null;
  lastCompleted: { serial: string; trayCount: number; bladeCount: number } | null = null;

  get inProgress(): boolean { return Boolean(this.container); }
  stationActivated(): void { if (!this.busy) this.refreshPickers(); }
  get containerOptions(): PickerOption[] {
    return this.filteredContainers.map((item) => ({ value: item.serial_number, cells: [item.serial_number, item.blade_count ?? '-', item.tray_count ?? '-'] }));
  }
  get trayOptions(): PickerOption[] {
    return this.filteredTrays.map((tray) => ({ value: tray.serial_number, cells: [tray.serial_number, tray.current_location?.serial_number || 'Unassigned', tray.blade_count ?? 0] }));
  }
  get sessionBladeCount(): number { return this.trays.reduce((sum, tray) => sum + Number(tray.blade_count ?? 0), 0); }
  /** What the operator should do next, shown when there is no message. */
  get prompt(): string {
    if (this.busy) return 'Working…';
    if (!this.container) return 'Scan the container to load, or choose it from the list.';
    if (!this.trays.length) return `Scan each tray going into ${this.container.serial_number}.`;
    return `Scan the next tray, or tap Finish Loading when ${this.container.serial_number} is full.`;
  }
  get finishBlockedReason(): string {
    if (!this.container || this.busy || this.trays.length) return '';
    return 'Scan at least one tray into the container first.';
  }

  /** Stop loading this container (every tray scanned in is already saved) and pick another. */
  changeContainer(): void {
    if (this.busy || !this.container) return;
    const serial = this.container.serial_number;
    const count = this.trays.length;
    this.container = null;
    this.trays = [];
    this.message = { tone: 'info', text: `Stopped loading ${serial}. ${count} tray${count === 1 ? ' is' : 's are'} saved in it. Scan a container to continue.` };
  }

  scanContainer(serial: string) {
    if (this.busy || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.container = null;
    this.trays = [];
    this.lastCompleted = null;
    this.message = null;
    this.busy = true;
    this.api.scanContainer(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (container) => {
        if (!container.workflow_eligibility?.load) {
          this.busy = false; this.message = { tone: 'error', text: `${container.serial_number} cannot be loaded. Use an empty container or one already packed for dispatch; a container that was sent belongs on Receive From Coater.` }; this.containerScanner?.select(); return;
        }
        this.container = container;
        this.trays = [...container.trays];
        this.lastCompleted = null;
        this.busy = false;
        this.containerScanner?.clearAndFocus();
        this.trayScanner?.focus();
        this.message = {
          tone: 'success',
          text: `Container ${container.serial_number} selected.`,
        };
      },
      error: (err: HttpErrorResponse) =>
        this.fail(err, 'Container not found.', this.containerScanner),
    });
  }
  scanTray(serial: string) {
    if (this.busy || !this.container || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.busy = true;
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (tray) => {
        if (!tray.workflow_eligibility?.coater_load) {
          this.busy = false; this.message = { tone: 'error', text: `Tray ${tray.serial_number} cannot be loaded. Only a full, ground tray on a rough shelf can go to the coater.` }; this.trayScanner?.select(); return;
        }
        if (this.trays.some((x) => x.id === tray.id)) {
          this.busy = false;
          this.message = {
            tone: 'info',
            text: `Tray ${tray.serial_number} is already in this session.`,
          };
          this.trayScanner?.clearAndFocus();
          return;
        }
        const container = this.container;
        if (!container) return;
        this.api.loadTrayIntoContainer(container.id, tray.id).pipe(takeUntil(this.destroyed$)).subscribe({
          next: () => {
            this.trays = [tray, ...this.trays];
            this.refreshPickers();
            this.busy = false;
            this.message = { tone: 'success', text: `Tray ${tray.serial_number} loaded into ${container.serial_number} (${this.trays.length} tray${this.trays.length === 1 ? '' : 's'}).` };
            this.toast.success(`Tray ${tray.serial_number} added.`, 'Tray loaded');
            this.trayScanner?.clearAndFocus();
          },
          error: (err: HttpErrorResponse) =>
            this.fail(
              err,
              'Could not add tray to container.',
              this.trayScanner,
            ),
        });
      },
      error: (err: HttpErrorResponse) =>
        this.fail(err, 'Tray not found.', this.trayScanner),
    });
  }
  finish() {
    if (!this.container || !this.trays.length || this.busy) return;
    const completed = {
      serial: this.container.serial_number,
      trayCount: this.trays.length,
      bladeCount: this.trays.reduce((sum, tray) => sum + Number(tray.blade_count ?? 0), 0),
    };
    this.lastCompleted = completed;
    this.refreshPickers();
    this.container = null;
    this.trays = [];
    this.message = { tone: 'success', text: `${completed.serial} finished with ${completed.trayCount} tray${completed.trayCount === 1 ? '' : 's'}. Send it from Coater Shipments, or scan the next container.` };
    this.toast.success(
      `${completed.serial} loading session finished with ${completed.trayCount} tray${completed.trayCount === 1 ? '' : 's'}. Scan another container to start the next load.`,
      'Container loading complete',
    );
    queueMicrotask(() => this.containerScanner?.clearAndFocus());
  }
  private fail(
    err: HttpErrorResponse,
    fallback: string,
    scanner?: ScanPanelComponent,
  ) {
    this.busy = false;
    this.message = { tone: 'error', text: apiErrorText(err, fallback) };
    scanner?.select();
  }
}
