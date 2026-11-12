import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { GearScannerFocusDirective, GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import {
  CutterBuildCard,
  CutterTeardownResult,
  CutterBuilderApiService,
  CutterDashboardData,
  cutterApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import {
  DEPARTMENT_CUTTERGRIND,
  parseCuttergrindNumberedShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';
import { ILocation, ITray } from '@meshforge/manufacturing/shared/util-types';
import {
  DanaConfirmDialogComponent,
  DanaPageHeaderComponent,
} from '@dana/ui';

@Component({
  selector: 'gear-cutter-teardown',
  standalone: true,
  imports: [CommonModule, GearScannerFocusDirective, FormsModule, DanaPageHeaderComponent, DanaConfirmDialogComponent],
  templateUrl: './cutter-teardown.component.html',
})
export class CutterTeardownComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private scanVersion = 0;
  ngOnDestroy(): void { ++this.scanVersion; this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(CutterBuilderApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(GearToastService);

  buildNumber = '';

  ngOnInit(): void {
    const build = this.route.snapshot.queryParamMap.get('build')?.trim();
    if (build) {
      this.buildNumber = build;
      this.scanBuild();
    }
  }
  traySerial = '';
  build: CutterBuildCard | null = null;
  tray: ITray | null = null;
  shelfLocationSerial = '';
  shelfLocation: ILocation | null = null;
  scrappedBladeCount = 0;
  comments = '';
  busy = false;
  error = '';
  message = '';
  result: CutterTeardownResult | null = null;
  teardownConfirmation = false;
  availablePulledBuilds: CutterDashboardData['pulled_builds'] = [];
  availableEmptyTrays: ITray[] = [];
  availableLocations: ILocation[] = [];
  selectedBuildNumber = ''; selectedTraySerial = ''; selectedShelfSerial = '';

  constructor() { this.refreshEligibleSelections(); }
  refreshEligibleSelections():void{
    this.api.getDashboard().pipe(takeUntil(this.destroyed$)).subscribe({next:d=>this.availablePulledBuilds=d.pulled_builds??[],error:()=>this.availablePulledBuilds=[]});
    this.api.getSelectionTrays().pipe(takeUntil(this.destroyed$)).subscribe({next:trays=>this.availableEmptyTrays=trays.filter(t=>t.enabled&&t.blade_count===0&&!t.current_container&&!t.current_cutter_build),error:()=>this.availableEmptyTrays=[]});
    this.api.getSelectionLocations().pipe(takeUntil(this.destroyed$)).subscribe({next:locations=>this.availableLocations=locations,error:()=>this.availableLocations=[]});
  }
  get eligibleDullShelves():ILocation[]{
    const expected=this.build?.part_type_code?.trim().toUpperCase(); if(!expected||!this.requiresDullShelf)return [];
    return this.availableLocations.filter(location=>{const tag=parseCuttergrindNumberedShelfTag(location.serial_number);return tag?.kind==='CUTTERGRIND_DULL'&&tag.partTypeCode===expected&&location.location_type==='SHELF'&&location.department===DEPARTMENT_CUTTERGRIND&&location.enabled;});
  }

  selectPulledBuild():void{if(this.selectedBuildNumber){this.buildNumber=this.selectedBuildNumber;this.scanBuild();}else this.buildChanged('');}
  selectEmptyTray():void{if(this.selectedTraySerial){this.traySerial=this.selectedTraySerial;this.scanTray();}else this.trayChanged('');}
  selectDullShelf():void{if(this.selectedShelfSerial){this.shelfLocationSerial=this.selectedShelfSerial;this.scanShelf();}else this.shelfChanged('');}

  get returnedBladeCount(): number {
    if (!this.build) return 0;
    return Math.max(this.build.blade_count - this.scrappedBladeCount, 0);
  }

  get requiresDullShelf(): boolean {
    return this.returnedBladeCount > 0;
  }

  get scrapCountValid(): boolean {
    return Boolean(
      this.build &&
        Number.isInteger(this.scrappedBladeCount) &&
        this.scrappedBladeCount >= 0 &&
        this.scrappedBladeCount <= this.build.blade_count,
    );
  }

  get canTeardown(): boolean {
    if (this.requiresDullShelf && !this.shelfLocation) return false;
    return Boolean(
      !this.busy && !this.result && this.build?.status_code === 'PULLED' && this.tray?.blade_count === 0 &&
      this.buildNumber.trim().toUpperCase() === this.build.build_number.toUpperCase() &&
      this.traySerial.trim().toUpperCase() === this.tray.serial_number.toUpperCase() &&
      this.scrapCountValid && (!this.requiresDullShelf ||
        this.shelfLocationSerial.trim().toUpperCase() === this.shelfLocation?.serial_number.toUpperCase())
    );
  }

  get teardownConfirmationMessage(): string {
    if (!this.build || !this.tray) return '';
    const destination = this.requiresDullShelf ? this.shelfLocation?.serial_number : 'no shelf (all blades scrapped)';
    return `Tear down ${this.build.build_number} into tray ${this.tray.serial_number}? ${this.returnedBladeCount} blades will be returned and ${this.scrappedBladeCount} scrapped. Destination: ${destination}. This records the teardown transaction.`;
  }

  askTeardown(): void {
    if (this.canTeardown) this.teardownConfirmation = true;
  }

  buildChanged(value: string): void {
    ++this.scanVersion; this.busy = false; this.buildNumber = value; this.build = null;
    this.selectedBuildNumber = ''; this.clearTeardownDownstream();
  }
  trayChanged(value: string): void {
    this.teardownConfirmation = false;
    ++this.scanVersion; this.busy = false; this.traySerial = value; this.tray = null;
    this.selectedTraySerial = ''; this.shelfLocationSerial = ''; this.shelfLocation = null;
    this.selectedShelfSerial = ''; this.result = null;
  }
  shelfChanged(value: string): void {
    this.teardownConfirmation = false;
    ++this.scanVersion; this.busy = false; this.shelfLocationSerial = value;
    this.shelfLocation = null; this.selectedShelfSerial = ''; this.result = null;
  }

  scanBuild(): void {
    if (this.busy) return;
    const value = this.buildNumber.trim();
    this.build = null; this.clearTeardownDownstream();
    if (!value) return;
    this.clearFeedback();
    this.clearTeardownDownstream();
    this.build = null;
    this.busy = true;

    const version = ++this.scanVersion;
    this.api.getCard(value).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (build) => {
        if (version !== this.scanVersion) return;
        this.build = build;
        this.buildNumber = build.build_number;
        if (build.status_code !== 'PULLED') {
          this.error = `Build ${build.build_number} must be PULLED before Cutter Builder can tear it down.`;
        }
        this.busy = false;
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.scanVersion) return;
        this.busy = false;
        this.error = cutterApiErrorText(err, 'Cutter build not found.');
      },
    });
  }

  scanTray(): void {
    if (this.busy) return;
    const value = this.traySerial.trim();
    this.tray = null; this.shelfLocation = null; this.shelfLocationSerial = '';
    this.result = null;
    if (!value || !this.build) return;
    this.clearFeedback();
    this.shelfLocationSerial = '';
    this.shelfLocation = null;
    this.busy = true;

    const version = ++this.scanVersion;
    this.api.scanTray(value).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (tray) => {
        if (version !== this.scanVersion) return;
        this.tray = tray;
        this.traySerial = tray.serial_number;
        this.busy = false;
        if (tray.blade_count !== 0) {
          this.error = `Tray ${tray.serial_number} is not empty.`;
        }
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.scanVersion) return;
        this.busy = false;
        this.tray = null;
        this.error = cutterApiErrorText(err, 'Teardown tray not found.');
      },
    });
  }


  scanShelf(): void {
    if (this.busy) return;
    this.shelfLocation = null;
    if (!this.requiresDullShelf) {
      this.shelfLocationSerial = '';
      this.shelfLocation = null;
      this.message = 'No shelf is required because this teardown returns zero blades. The tray will be Available / Ready to Use.';
      this.error = '';
      return;
    }
    const value = this.shelfLocationSerial.trim();
    if (!value) return;
    this.clearFeedback();
    this.busy = true;

    const version = ++this.scanVersion;
    this.api.scanLocation(value).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (location) => {
        if (version !== this.scanVersion) return;
        this.busy = false;
        const numberedShelf = parseCuttergrindNumberedShelfTag(
          location.serial_number,
        );
        const expectedPartType = this.build?.part_type_code?.trim().toUpperCase();
        if (
          !this.build ||
          !numberedShelf ||
          numberedShelf.kind !== 'CUTTERGRIND_DULL' ||
          numberedShelf.partTypeCode !== expectedPartType ||
          location.location_type !== 'SHELF' ||
          location.department !== DEPARTMENT_CUTTERGRIND
        ) {
          this.shelfLocation = null;
          this.error = this.build
            ? `${this.build.part_type_code} dull blades must go to an available ${expectedPartType === 'RING' ? 'CGDR' : 'CGDP'} dull shelf, such as ${expectedPartType === 'RING' ? 'CGDR' : 'CGDP'}-A1A (shelf, layer, bin).`
            : 'Scan the cutter build before scanning the dull shelf.';
          return;
        }
        this.shelfLocation = location;
        this.shelfLocationSerial = location.serial_number;
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.scanVersion) return;
        this.busy = false;
        this.shelfLocation = null;
        this.error = cutterApiErrorText(err, 'Shelf location not found.');
      },
    });
  }

  teardown(): void {
    if (!this.teardownConfirmation || !this.canTeardown || !this.build || !this.tray) return;
    this.teardownConfirmation = false;
    this.clearFeedback();
    this.busy = true;

    this.api.teardownBuild({
      buildNumber: this.build.build_number,
      teardownTraySerial: this.tray.serial_number,
      scrappedBladeCount: this.scrappedBladeCount,
      shelfLocationSerial: this.requiresDullShelf ? this.shelfLocation?.serial_number ?? null : null,
      comments: this.comments,
    }).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (result) => {
        this.busy = false;
        this.result = result;
        const message = result.tray_available_for_use
          ? `Teardown complete: all ${result.scrapped_blade_count} blades scrapped. Tray ${result.teardown_tray_serial_number} is Available / Ready to Use with no location required.`
          : `Teardown complete: ${result.returned_blade_count} returned, ${result.scrapped_blade_count} scrapped.`;
        this.message = '';
        this.toast.success(message, 'Cutter teardown complete');
        this.refreshEligibleSelections();
      },
      error: (err: HttpErrorResponse) => {
        this.busy = false;
        const message = cutterApiErrorText(err, 'Could not tear down cutter.');
        this.error = message;
        this.toast.error(message, 'Cutter teardown failed');
      },
    });
  }

  reset(): void {
    this.teardownConfirmation = false;
    ++this.scanVersion; this.busy = false;
    this.selectedBuildNumber = ''; this.selectedTraySerial = ''; this.selectedShelfSerial = '';
    this.buildNumber = '';
    this.traySerial = '';
    this.build = null;
    this.tray = null;
    this.shelfLocationSerial = '';
    this.shelfLocation = null;
    this.scrappedBladeCount = 0;
    this.comments = '';
    this.result = null;
    this.clearFeedback();
  }

  private clearTeardownDownstream(): void {
    this.teardownConfirmation = false;
    this.traySerial = '';
    this.selectedTraySerial = '';
    this.tray = null;
    this.shelfLocationSerial = '';
    this.selectedShelfSerial = '';
    this.shelfLocation = null;
    this.scrappedBladeCount = 0;
    this.comments = '';
    this.result = null;
  }

  private clearFeedback(): void {
    this.error = '';
    this.message = '';
  }
}
