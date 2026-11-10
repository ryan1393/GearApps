import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { isPendingGrindingStatus, parseCuttergrindRoughShelfTag, cuttergrindRoughShelfForPartType } from '@gearapps/manufacturing/shared/util-constants';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GearToastService } from '@gearapps/manufacturing/frontend/util-common';
import { BladeStatus } from '@gearapps/manufacturing/shared/util-types';
import {
  BladeTrackingApiService,
  TrayGrindingRunView,
  InventoryTrayRow,
  InventoryLocationRow,
  apiErrorText,
} from '@gearapps/manufacturing/frontend/data-access-blade-tracking';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import { DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';

@Component({
  selector: 'gear-blade-grinding',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ScanPanelComponent, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './grinding.component.html',
})
export class GrindingComponent implements OnInit, OnDestroy {
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);
  private readonly destroyed$ = new Subject<void>();
  private selectionVersion = 0;
  private shelfRequestVersion = 0;
  @ViewChild('trayScanner') trayScanner?: ScanPanelComponent;
  tray: InventoryTrayRow | null = null;
  availableTrays: InventoryTrayRow[] = [];
  selectedTraySerial = '';
  traySearch = '';
  pickerLoading = false;
  pickerError = '';
  scrappedBladeCount = 0;
  grindingRuns: TrayGrindingRunView[] = [];
  historyLoading = false;
  historyError = '';
  busy = false;
  roughShelves: InventoryLocationRow[] = [];
  roughShelfSerial = '';
  shelvesLoading = false;
  shelvesError = '';
  resolvedRequiredBlades: number | null = null;
  requirementLoading = false;
  requirementError = '';

  ngOnInit(): void { this.refreshPickers(); this.refreshShelves(); }
  ngOnDestroy(): void { this.selectionVersion++; this.shelfRequestVersion++; this.destroyed$.next(); this.destroyed$.complete(); }
  get filteredTrays() { const q=this.traySearch.trim().toLowerCase(); return this.availableTrays.filter(t=>!q||t.serial_number.toLowerCase().includes(q)); }
  get pendingGrindingCount(): number { return this.tray?.blades.filter(b => isPendingGrindingStatus(b.status)).length ?? 0; }
  get previouslyReadyCount(): number { return this.tray?.blades.filter(b => b.status === BladeStatus.READY_FOR_COATING).length ?? 0; }
  get returnedAfterGrinding(): number { return Math.max(this.pendingGrindingCount - this.scrappedBladeCount, 0); }
  get waitingToStart(): boolean { return this.tray?.current_stage?.code === 'WAITING_FOR_GRINDING'; }
  get grindingScrapValid(): boolean { return Number.isInteger(this.scrappedBladeCount) && this.scrappedBladeCount >= 0 && this.scrappedBladeCount <= this.pendingGrindingCount; }
  get requiredBlades(): number | null {
    const count = this.tray?.required_blade_count ?? this.resolvedRequiredBlades;
    return Number.isInteger(count) && Number(count) > 0 ? Number(count) : null;
  }
  get fullAfterGrinding(): boolean {
    return this.requiredBlades !== null && this.previouslyReadyCount + this.returnedAfterGrinding === this.requiredBlades;
  }
  get expectedShelfPrefix(): string { return cuttergrindRoughShelfForPartType(this.tray?.part_type?.code) ?? 'CGRR/CGRP'; }
  get matchingRoughShelves(): InventoryLocationRow[] {
    return this.roughShelves.filter(shelf => {
      const tag = parseCuttergrindRoughShelfTag(shelf.serial_number);
      return shelf.enabled && tag && tag.partTypeCode === this.tray?.part_type?.code && shelf.department === tag.department && shelf.location_type === tag.locationType;
    });
  }
  get hasSelectedRoughShelf(): boolean { return this.matchingRoughShelves.some(shelf => shelf.serial_number === this.roughShelfSerial); }
  get canRecordGrinding(): boolean {
    return Boolean(!this.busy && this.tray?.workflow_eligibility?.grinding && (this.waitingToStart ||
      (this.tray.current_stage?.code === 'GRINDING' && this.pendingGrindingCount > 0 && this.grindingScrapValid && !this.requirementLoading &&
       this.requiredBlades !== null && this.previouslyReadyCount + this.returnedAfterGrinding <= this.requiredBlades && (!this.fullAfterGrinding || (!this.shelvesLoading && this.hasSelectedRoughShelf)))));
  }
  /** Blades still missing after grinding was recorded; a short tray is not ready for coating whatever its stored stage says. */
  get bladesShort(): number {
    const tray = this.tray;
    if (!tray || tray.current_stage?.code !== 'READY_FOR_COATING' || this.requiredBlades === null) return 0;
    return Math.max(this.requiredBlades - tray.blade_count, 0);
  }
  get stageLabel(): string {
    if (this.bladesShort > 0) return 'Needs replacement blades';
    return this.tray?.current_stage?.name || 'Grinding';
  }
  get stageTone(): 'ready' | 'attention' | 'active' {
    if (this.bladesShort > 0) return 'attention';
    return this.tray?.current_stage?.code === 'READY_FOR_COATING' ? 'ready' : 'active';
  }

  refreshShelves(): void {
    const request = ++this.shelfRequestVersion;
    this.shelvesLoading = true; this.shelvesError = '';
    this.api.getAllLocations().pipe(takeUntil(this.destroyed$)).subscribe({
      next: shelves => {
        if (request !== this.shelfRequestVersion) return;
        this.roughShelves = shelves.filter(shelf => Boolean(parseCuttergrindRoughShelfTag(shelf.serial_number))).sort((a,b) => a.serial_number.localeCompare(b.serial_number));
        this.shelvesLoading = false;
        if (!this.hasSelectedRoughShelf) this.roughShelfSerial = '';
      },
      error: e => {
        if (request !== this.shelfRequestVersion) return;
        this.roughShelves = []; this.roughShelfSerial = ''; this.shelvesLoading = false;
        this.shelvesError = apiErrorText(e, 'Could not load numbered rough shelves.');
      },
    });
  }
  selectRoughShelf(value: string): void {
    if (this.busy || this.shelvesLoading) return;
    const serial = value.trim().toUpperCase();
    this.roughShelfSerial = '';
    if (!serial) return;
    if (!this.matchingRoughShelves.some(shelf => shelf.serial_number === serial)) {
      this.toast.error(`Choose an existing enabled ${this.expectedShelfPrefix}-### shelf. Add real numbered shelves in Admin > Locations.`, 'Rough shelf unavailable');
      return;
    }
    this.roughShelfSerial = serial;
  }

  refreshPickers(): void {
    this.pickerLoading=true; this.pickerError='';
    this.api.getWorkflowTrays('grinding').pipe(takeUntil(this.destroyed$)).subscribe({
      next: rows => { this.availableTrays=rows; this.pickerLoading=false; },
      error: e => { this.availableTrays=[]; this.pickerLoading=false; this.pickerError=apiErrorText(e,'Could not load trays available for grinding.'); },
    });
  }
  chooseTray(serial: string): void { this.scanTray(serial); }
  scanTray(serial: string): void { if(this.busy||!serial.trim()) return; this.loadTray(serial.trim().toUpperCase(),true); }
  retryTray(): void { if(!this.selectedTraySerial||this.busy) return; this.loadTray(this.selectedTraySerial,false); }
  private loadTray(serial:string,checkEligibility:boolean):void {
    const version=++this.selectionVersion; this.selectedTraySerial=serial; this.roughShelfSerial=''; this.resolvedRequiredBlades=null; this.requirementError=''; this.requirementLoading=false; this.busy=true; this.tray=null; this.grindingRuns=[]; this.historyLoading=true; this.historyError='';
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: tray => {
        if(version!==this.selectionVersion) return;
        if(!tray.workflow_eligibility?.grinding && checkEligibility){ this.tray=null; this.busy=false; this.historyLoading=false; this.toast.error(`Tray ${serial} is not currently available for grinding.`,'Grinding unavailable'); return; }
        this.tray=tray; this.scrappedBladeCount=0; this.loadRequirement(tray,version);
        this.api.getTrayGrindingRuns(tray.id).pipe(takeUntil(this.destroyed$)).subscribe({
          next:runs=>{ if(version!==this.selectionVersion) return; this.grindingRuns=runs; this.historyLoading=false; this.busy=false; },
          error:e=>{ if(version!==this.selectionVersion) return; this.historyLoading=false; this.busy=false; this.historyError=apiErrorText(e,'Could not load grinding history.'); },
        });
      },
      error:e=>{ if(version!==this.selectionVersion) return; this.busy=false; this.historyLoading=false; this.toast.error(apiErrorText(e,'Could not load tray.'),'Tray lookup failed'); },
    });
  }
  private loadRequirement(tray: InventoryTrayRow, version: number): void {
    if (tray.required_blade_count != null || tray.current_stage?.code !== 'GRINDING') return;
    const summaryId = tray.summary_id ?? tray.summary?.id;
    const partTypeId = tray.part_type_id ?? tray.part_type?.id;
    if (!summaryId || !partTypeId) { this.requirementError = 'Tray Summary / Part Type is missing.'; return; }
    this.requirementLoading = true;
    this.api.resolveBladeRequirement(summaryId, partTypeId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: result => {
        if (version !== this.selectionVersion) return;
        const count = Number(result.required_blade_count);
        this.resolvedRequiredBlades = Number.isInteger(count) && count > 0 ? count : null;
        this.requirementLoading = false;
        if (this.resolvedRequiredBlades === null) this.requirementError = 'No positive blade requirement is configured for this Summary / Part Type.';
      },
      error: e => {
        if (version !== this.selectionVersion) return;
        this.requirementLoading = false; this.resolvedRequiredBlades = null;
        this.requirementError = apiErrorText(e, 'Could not load the blade requirement. Refresh the tray before completing grinding.');
      },
    });
  }
  recordGrinding(): void {
    const tray=this.tray; if(!tray||!this.canRecordGrinding) return; const serial=tray.serial_number; this.busy=true;
    if(this.waitingToStart){
      this.api.startTrayGrinding(tray.id).pipe(takeUntil(this.destroyed$)).subscribe({
        next:()=>{ this.toast.success(`Grinding started for ${serial}.`,'Grinding started'); this.refreshPickers(); this.loadTray(serial,false); },
        error:e=>{ this.busy=false; this.toast.error(apiErrorText(e,'Could not start grinding.'),'Grinding not started'); },
      }); return;
    }
    const summaryId=tray.summary_id??tray.summary?.id??''; const partTypeId=tray.part_type_id??tray.part_type?.id??'';
    if(!summaryId||!partTypeId){ this.busy=false; this.toast.error('Tray Summary / Part Type is missing.','Grinding not recorded'); return; }
    this.api.completeTrayGrinding(tray.id,summaryId,partTypeId,this.scrappedBladeCount,this.fullAfterGrinding ? this.roughShelfSerial : undefined).pipe(takeUntil(this.destroyed$)).subscribe({
      next:result=>{
        const base=`${result.scrapped_blade_count} scrapped; ${result.returned_blade_count} returned. Tray ${result.active_blade_count}/${result.required_blade_count}.`;
        if(result.complete) this.toast.success(`${base} Staged on ${result.rough_shelf_serial_number}.`,'Grinding complete');
        else this.toast.info(`${base} Add ${result.blades_needed} replacement blade(s) in Blade Intake.`,'Tray needs replacements');
        this.trayScanner?.clearAndFocus();
        this.refreshPickers(); this.refreshShelves(); this.loadTray(serial,false);
      },
      error:e=>{ this.busy=false; this.tray=null; this.roughShelfSerial=''; this.refreshPickers(); this.toast.error(apiErrorText(e,'Could not record grinding. Refresh or scan the tray before trying again.'),'Grinding result needs refresh'); },
    });
  }
}
