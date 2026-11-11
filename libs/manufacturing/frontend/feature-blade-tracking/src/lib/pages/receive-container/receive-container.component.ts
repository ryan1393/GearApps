import { Subject, takeUntil } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewChild, inject, OnDestroy } from '@angular/core';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import {
  DEPARTMENT_CUTTERGRIND,
  parseCuttergrindNumberedShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';
import { IContainer, IContainerTray, ILocation, ITray } from '@meshforge/manufacturing/shared/util-types';
import {
  BladeTrackingApiService,
  ContainerBladeSetRow,
  InventoryContainerRow,
  apiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { ScanMessage } from '../../models/scan-message';
import { OptionPickerComponent, PickerOption } from '../../shared/option-picker/option-picker.component';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import { StationStatusComponent } from '../../shared/station-status/station-status.component';
import { StationOperation } from '../operations-station/operations-station.operations';
import { DanaPageHeaderComponent } from '@dana/ui';

@Component({
  selector: 'gear-receive-container',
  standalone: true,
  imports: [DanaPageHeaderComponent, CommonModule, FormsModule, ScanPanelComponent, StationStatusComponent, OptionPickerComponent],
  templateUrl: './receive-container.component.html',
})
export class ReceiveContainerComponent implements OnDestroy, StationOperation {
  private readonly destroyed$ = new Subject<void>();
  ngOnDestroy(): void { this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);

  @ViewChild('containerScanner') containerScanner?: ScanPanelComponent;
  @ViewChild('trayScanner') trayScanner?: ScanPanelComponent;
  @ViewChild('shelfScanner') shelfScanner?: ScanPanelComponent;

  container: IContainer | null = null;
  expected: IContainerTray[] = [];
  received: ITray[] = [];
  pendingTray: ITray | null = null;
  pendingShelf: ILocation | null = null;
  /** Where each tray received in this session was put, by tray id. */
  receivedShelves: Record<string, string> = {};
  /** The container's blade set, when it holds one: it goes into any empty tray the operator scans. */
  bladeSet: ContainerBladeSetRow | null = null;
  setReceived = false;
  get receivingSet(): boolean { return Boolean(this.bladeSet && !this.setReceived); }
  /** RING / PINION of what is being received: the set's, or the selected tray's. */
  get receivingPartType(): string { return (this.bladeSet?.part_type_code ?? this.pendingTray?.part_type?.code ?? '').trim().toUpperCase(); }

  get inProgress(): boolean { return Boolean(this.container); }
  stationActivated(): void { if (!this.busy) this.refreshPickers(); }
  /** The finished shelf series for the selected tray: CGFR for RING, CGFP for PINION. */
  get shelfPrefix(): string { return this.receivingPartType === 'RING' ? 'CGFR' : 'CGFP'; }
  get totalTrays(): number { return this.expected.length + this.received.length + (this.receivingSet ? 1 : 0); }
  get containerOptions(): PickerOption[] {
    return this.filteredContainers.map((item) => ({ value: item.serial_number, cells: [item.serial_number, item.blade_count ?? '-', item.tray_count ?? '-'] }));
  }
  get trayOptions(): PickerOption[] {
    if (this.bladeSet) return [];
    return this.filteredExpected.map((x) => ({ value: x.tray.serial_number, cells: [x.tray.serial_number, x.tray.part_type?.code || '—', x.tray.blade_count ?? 0] }));
  }
  get shelfOptions(): PickerOption[] {
    return this.eligibleFinishedShelves.map((location) => ({ value: location.serial_number, cells: [location.serial_number, location.description || 'Empty shelf'] }));
  }
  /** What the operator should do next, shown when there is no message. */
  get prompt(): string {
    if (this.busy) return 'Working…';
    if (!this.container) return 'Scan the returned container, or choose it from the list.';
    if (this.pendingTray) return `Put tray ${this.pendingTray.serial_number} on an empty ${this.shelfPrefix} shelf and scan the shelf tag.`;
    if (this.receivingSet) return `Scan an empty tray for the ${this.bladeSet?.blades.length} blades in ${this.container.serial_number}.`;
    if (this.expected.length) return `Scan the next tray out of ${this.container.serial_number}: ${this.expected.length} still expected.`;
    return `Every tray is received. Tap Finish Receiving ${this.container.serial_number}.`;
  }
  get finishBlockedReason(): string {
    if (!this.container || this.busy) return '';
    if (this.pendingTray) return `Finish shelving tray ${this.pendingTray.serial_number} first.`;
    if (this.receivingSet) return `Put the set into an empty tray and onto a ${this.shelfPrefix} shelf first.`;
    if (this.expected.length) return `${this.expected.length} tray${this.expected.length === 1 ? ' is' : 's are'} still expected. If one is missing, tap Stop to come back later.`;
    return '';
  }

  /**
   * Leave this container without finishing it, e.g. when a tray is missing. Every tray already
   * shelved is saved; scanning the container again picks up the trays still expected.
   */
  stopReceiving(): void {
    if (this.busy || !this.container) return;
    const serial = this.container.serial_number;
    const left = this.expected.length;
    const done = this.received.length;
    this.container = null;
    this.expected = [];
    this.received = [];
    this.receivedShelves = {};
    this.pendingTray = null;
    this.pendingShelf = null;
    this.bladeSet = null;
    this.setReceived = false;
    this.refreshPickers();
    this.message = {
      tone: 'info',
      text: `Stopped receiving ${serial}: ${done} received, ${left} still expected. Scan it again to continue.`,
    };
  }
  availableContainers:InventoryContainerRow[]=[]; availableLocations:ILocation[]=[]; selectedContainerSerial=''; selectedTraySerial=''; containerSearch=''; traySearch='';
  get eligibleFinishedShelves():ILocation[]{
    const type=this.receivingPartType;
    if(!type)return [];
    return this.availableLocations.filter(location=>{
      const shelf=parseCuttergrindNumberedShelfTag(location.serial_number);
      return shelf?.kind==='CUTTERGRIND_FINISHED' && shelf.partTypeCode===type &&
        location.location_type==='SHELF' && location.department===DEPARTMENT_CUTTERGRIND &&
        (location as any).active!==false && (location as any).enabled!==false &&
        Number((location as any).tray_count??0)===0;
    });
  }
  get filteredContainers(){const q=this.containerSearch.trim().toLowerCase();return q?this.availableContainers.filter(x=>x.serial_number.toLowerCase().includes(q)):this.availableContainers;} get filteredExpected(){const q=this.traySearch.trim().toLowerCase();return q?this.expected.filter(x=>x.tray.serial_number.toLowerCase().includes(q)):this.expected;}
  pickerError = '';
  private pickerVersion = 0;
  constructor(){this.refreshPickers();}
  refreshPickers(): void {
    const version = ++this.pickerVersion; this.pickerError = '';
    this.api.getWorkflowContainers('receive').pipe(takeUntil(this.destroyed$)).subscribe({ next: rows => { if(version === this.pickerVersion) this.availableContainers = rows; }, error: e => { if(version === this.pickerVersion) { this.availableContainers = []; this.pickerError = apiErrorText(e, 'Could not load containers awaiting return.'); } } });
    this.api.getAllLocations().pipe(takeUntil(this.destroyed$)).subscribe({next:rows=>{if(version===this.pickerVersion)this.availableLocations=rows;},error:e=>{if(version===this.pickerVersion){this.availableLocations=[];this.pickerError=apiErrorText(e,'Could not load finished shelf locations.');}}});
  }
  chooseContainer(s:string){if(s)this.scanContainer(s);} chooseTray(s:string){if(s)this.scanTray(s);} chooseShelf(s:string){if(s)this.scanShelf(s);}
  busy = false;
  message: ScanMessage | null = null;

  scanContainer(serial: string): void {
    if (this.busy || this.container || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.busy = true;
    this.expected = [];
    this.received = [];
    this.pendingTray = null;
    this.pendingShelf = null;
    this.bladeSet = null;
    this.setReceived = false;

    this.api.scanContainer(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (container) => {
        if (!container.workflow_eligibility?.receive) {
          this.busy = false; this.message = { tone: 'error', text: `${container.serial_number} has no trays waiting to come back from the coater. Check the container number.` }; this.containerScanner?.select(); return;
        }
        this.container = container;
        if (container.blade_set) {
          this.bladeSet = container.blade_set;
          this.busy = false;
          this.containerScanner?.clearAndFocus();
          this.trayScanner?.focus();
          this.message = {
            tone: 'success',
            text: `${container.serial_number} holds one set: ${container.blade_set.blades.length} ${container.blade_set.part_type_code ?? ''} blades, Summary ${container.blade_set.summary_number ?? '—'}. Scan an empty tray for them.`,
          };
          return;
        }
        this.api.getActiveContainerTrays(container.id).pipe(takeUntil(this.destroyed$)).subscribe({
          next: (items) => {
            this.expected = items;
            this.busy = false;
            this.containerScanner?.clearAndFocus();
            this.trayScanner?.focus();
            this.message = {
              tone: items.length ? 'success' : 'info',
              text: `${container.serial_number} has ${items.length} expected tray${items.length === 1 ? '' : 's'}.`,
            };
          },
          error: (err: HttpErrorResponse) =>
            { this.container = null; this.fail(err, 'Could not load expected trays.'); },
        });
      },
      error: (err: HttpErrorResponse) =>
        this.fail(err, 'Container not found.', this.containerScanner),
    });
  }

  scanTray(serial: string): void {
    if (this.busy || !this.container || this.pendingTray || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.busy = true;

    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (tray) => {
        if (this.bladeSet) {
          if (tray.current_stage?.code !== 'EMPTY' || tray.blade_count !== 0) {
            this.busy = false;
            this.message = { tone: 'error', text: `Tray ${tray.serial_number} is not empty. The returned set goes into an empty tray; scan another.` };
            this.trayScanner?.clearAndFocus();
            return;
          }
          this.pendingTray = tray;
          this.busy = false;
          this.message = { tone: 'info', text: `Put the set into tray ${tray.serial_number}, then scan any available ${this.shelfPrefix} finished shelf, such as ${this.shelfPrefix}-A1A.` };
          queueMicrotask(() => this.shelfScanner?.focus());
          return;
        }
        const match = this.expected.find(
          (x) => x.tray_id === tray.id && x.enabled,
        );
        if (!match || tray.current_stage?.code !== 'AT_COATER') {
          this.busy = false;
          this.message = {
            tone: 'error',
            text: `Tray ${tray.serial_number} is not on the expected list for ${this.container?.serial_number}. Check the tray, or choose one from the list.`,
          };
          this.trayScanner?.clearAndFocus();
          return;
        }

        this.pendingTray = tray;
        this.busy = false;
        this.message = {
          tone: 'info',
          text: tray.summary?.number
            ? tray.part_type?.code
              ? `Tray ${tray.serial_number} selected. Scan any available ${tray.part_type.code === 'RING' ? 'CGFR' : 'CGFP'} finished shelf, such as ${tray.part_type.code === 'RING' ? 'CGFR' : 'CGFP'}-A1A.`
              : `Tray ${tray.serial_number} selected, but it has no Part Type assigned.`
            : `Tray ${tray.serial_number} selected, but it has no summary assigned.`,
        };
        queueMicrotask(() => this.shelfScanner?.focus());
      },
      error: (err: HttpErrorResponse) =>
        this.fail(err, 'Tray not found.', this.trayScanner),
    });
  }

  scanShelf(serial: string): void {
    const pendingTray = this.pendingTray;
    if (this.busy || !this.container || !pendingTray || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.busy = true;

    this.api.scanLocation(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (location) => {
        const summaryNumber = this.bladeSet?.summary_number ?? pendingTray.summary?.number;
        if (!summaryNumber) {
          this.busy = false;
          this.message = {
            tone: 'error',
            text: `Tray ${pendingTray.serial_number} does not have a summary assigned.`,
          };
          this.shelfScanner?.clearAndFocus();
          return;
        }

        const partTypeCode = this.receivingPartType;
        if (!partTypeCode) {
          this.busy = false;
          this.message = {
            tone: 'error',
            text: `Tray ${pendingTray.serial_number} does not have a Part Type assigned.`,
          };
          this.shelfScanner?.clearAndFocus();
          return;
        }

        const numberedShelf = parseCuttergrindNumberedShelfTag(
          location.serial_number,
        );
        const expectedPartType = partTypeCode.trim().toUpperCase();
        if (
          !numberedShelf ||
          numberedShelf.kind !== 'CUTTERGRIND_FINISHED' ||
          numberedShelf.partTypeCode !== expectedPartType ||
          location.location_type !== 'SHELF' ||
          location.department !== DEPARTMENT_CUTTERGRIND
        ) {
          this.busy = false;
          this.message = {
            tone: 'error',
            text: `${partTypeCode} finished blades must go to an available ${expectedPartType === 'RING' ? 'CGFR' : 'CGFP'} finished shelf, such as ${expectedPartType === 'RING' ? 'CGFR' : 'CGFP'}-A1A (shelf, layer, bin).`,
          };
          this.shelfScanner?.clearAndFocus();
          return;
        }

        this.pendingShelf = location;
        const tray = pendingTray;
        const container = this.container;
        if (!tray || !container) return;

        this.api
          .unloadTray(container.id, tray.id, location.serial_number)
          .pipe(takeUntil(this.destroyed$)).subscribe({
            next: () => {
              this.refreshPickers();
              if (this.bladeSet) this.setReceived = true;
              this.expected = this.expected.filter((x) => x.tray_id !== tray.id);
              this.received = [tray, ...this.received];
              this.receivedShelves = { ...this.receivedShelves, [tray.id]: location.serial_number };
              this.pendingTray = null;
              this.pendingShelf = null;
              this.busy = false;
              this.message = { tone: 'success', text: `Tray ${tray.serial_number} received onto ${location.serial_number}.` };
              this.toast.success(
                `Tray ${tray.serial_number} received and stored at ${location.serial_number}.`,
                'Tray received',
              );
              queueMicrotask(() => this.trayScanner?.clearAndFocus());
            },
            error: (err: HttpErrorResponse) =>
              this.fail(err, 'Could not receive tray.', this.shelfScanner),
          });
      },
      error: (err: HttpErrorResponse) =>
        this.fail(err, 'Shelf location not found.', this.shelfScanner),
    });
  }

  cancelPendingTray(): void {
    if (this.busy) return;
    this.pendingTray = null;
    this.pendingShelf = null;
    this.message = { tone: 'info', text: 'Tray selection cleared.' };
    queueMicrotask(() => this.trayScanner?.focus());
  }

  finish(): void {
    if (this.busy || !this.container || this.expected.length || this.pendingTray || this.receivingSet) return;
    const serial = this.container.serial_number;
    const count = this.received.length;
    this.container = null;
    this.refreshPickers();
    this.received = [];
    this.receivedShelves = {};
    this.expected = [];
    this.bladeSet = null;
    this.setReceived = false;
    this.message = { tone: 'success', text: `${serial} received: ${count} tray${count === 1 ? '' : 's'} shelved. Scan the next container.` };
    this.toast.success(
      `${serial} receiving complete. ${count} trays unloaded to tagged shelf locations.`,
      'Container received',
    );
    this.containerScanner?.focus();
  }

  private fail(
    err: HttpErrorResponse,
    fallback: string,
    scanner?: ScanPanelComponent,
  ): void {
    this.busy = false;
    this.message = { tone: 'error', text: apiErrorText(err, fallback) };
    scanner?.select();
  }
}
