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
  InventoryContainerRow,
  apiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { ScanMessage } from '../../models/scan-message';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import {
  DanaPageHeaderComponent,
} from '@dana/ui';

@Component({
  selector: 'gear-receive-container',
  standalone: true,
  imports: [CommonModule, FormsModule, ScanPanelComponent, DanaPageHeaderComponent],
  templateUrl: './receive-container.component.html',
})
export class ReceiveContainerComponent implements OnDestroy {
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
  availableContainers:InventoryContainerRow[]=[]; availableLocations:ILocation[]=[]; selectedContainerSerial=''; selectedTraySerial=''; containerSearch=''; traySearch='';
  get eligibleFinishedShelves():ILocation[]{
    const type=this.pendingTray?.part_type?.code?.trim().toUpperCase();
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

    this.api.scanContainer(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (container) => {
        if (!container.workflow_eligibility?.receive) {
          this.busy = false; this.message = { tone: 'error', text: 'Only an enabled container with trays awaiting coater return can be received.' }; return;
        }
        this.container = container;
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
        const match = this.expected.find(
          (x) => x.tray_id === tray.id && x.enabled,
        );
        if (!match || tray.current_stage?.code !== 'AT_COATER') {
          this.busy = false;
          this.message = {
            tone: 'error',
            text: `Tray ${tray.serial_number} is not expected in ${this.container?.serial_number}.`,
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
              ? `Tray ${tray.serial_number} selected. Scan any available ${tray.part_type.code === 'RING' ? 'CGFR' : 'CGFP'} numbered finished shelf.`
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
        const summaryNumber = pendingTray.summary?.number;
        if (!summaryNumber) {
          this.busy = false;
          this.message = {
            tone: 'error',
            text: `Tray ${pendingTray.serial_number} does not have a summary assigned.`,
          };
          this.shelfScanner?.clearAndFocus();
          return;
        }

        const partTypeCode = pendingTray.part_type?.code;
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
            text: `${partTypeCode} finished blades must go to an available ${expectedPartType === 'RING' ? 'CGFR' : 'CGFP'} numbered shelf.`,
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
              this.expected = this.expected.filter((x) => x.tray_id !== tray.id);
              this.received = [tray, ...this.received];
              this.pendingTray = null;
              this.pendingShelf = null;
              this.busy = false;
              this.message = null;
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
    if (this.busy || !this.container || this.expected.length || this.pendingTray) return;
    const serial = this.container.serial_number;
    const count = this.received.length;
    this.container = null;
    this.refreshPickers();
    this.received = [];
    this.expected = [];
    this.message = null;
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
