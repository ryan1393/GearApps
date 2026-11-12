import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { COATER_STAGING_LOCATION_SERIAL, isPendingGrindingStatus, parseCuttergrindRoughShelfTag, cuttergrindRoughShelfForPartType } from '@meshforge/manufacturing/shared/util-constants';
import { autoShelfFor } from '../../shared/auto-shelf/auto-shelf';
import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MachineDsfCountComponent, GearToastService, ScanMessage, CountStepperComponent, OptionPickerComponent, PickerOption, ScanPanelComponent, StationStatusComponent } from '@meshforge/manufacturing/frontend/util-common';
import { BladeStatus } from '@meshforge/manufacturing/shared/util-types';
import {
  BladeTrackingApiService,
  TrayGrindingRunView,
  GrindingMachine,
  InventoryTrayRow,
  InventoryLocationRow,
  InventoryContainerRow,
  apiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { StationOperation } from '../operations-station/operations-station.operations';
import { DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';

@Component({
  selector: 'gear-blade-grinding',
  standalone: true,
  imports: [DanaPageHeaderComponent, MachineDsfCountComponent, CommonModule, FormsModule, RouterLink, ScanPanelComponent, StationStatusComponent, OptionPickerComponent, CountStepperComponent, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './grinding.component.html',
})
export class GrindingComponent implements OnInit, OnDestroy, StationOperation {
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);
  private readonly destroyed$ = new Subject<void>();
  private selectionVersion = 0;
  private shelfRequestVersion = 0;
  @ViewChild('trayScanner') trayScanner?: ScanPanelComponent;
  grinders: GrindingMachine[] = [];
  grinderId = '';
  grinderLoading = false;
  grinderError = '';
  changingGrinder = false;
  machineHistory: TrayGrindingRunView[] = [];
  machineHistoryError = '';
  machineHistoryLoading = false;
  private machineHistoryVersion = 0;
  get grinder() { return this.grinders.find(machine => machine.id === this.grinderId); }
  get assignedGrinderNumber(): string { return this.grinders.find(machine => machine.id === this.tray?.current_grinding_machine_id)?.machine_number || 'its assigned grinder'; }
  get grinderMatchesTray(): boolean {
    return !this.tray?.current_grinding_machine_id || this.tray.current_grinding_machine_id === this.grinderId;
  }
  refreshGrinders(): void {
    this.grinderLoading = true; this.grinderError = '';
    this.api.getGrindingMachines().pipe(takeUntil(this.destroyed$)).subscribe({
      next: rows => {
        this.grinders = rows; this.grinderLoading = false;
        let saved = this.grinderId;
        try { saved ||= localStorage.getItem('gear.grinding.machine') || ''; } catch { /* browser storage may be disabled */ }
        this.grinderId = rows.some(machine => machine.id === saved) ? saved : '';
        this.openRequestedTray();
      },
      error: error => { this.grinderLoading = false; this.grinders = []; this.grinderError = apiErrorText(error, 'Could not load grinders.'); },
    });
  }
  selectGrinder(id: string): void {
    if (this.busy || !this.grinders.some(machine => machine.id === id)) return;
    this.message = null;
    this.grinderId = id; this.changingGrinder = false; this.machineHistory = []; this.machineHistoryVersion++; this.loadMachineHistory();
    try { localStorage.setItem('gear.grinding.machine', id); } catch { /* selection still works without storage */ }
    this.trayScanner?.clearAndFocus();
    this.openRequestedTray();
  }

  /** A tray another screen asked for (`?tray=` on the station), waiting for this workstation's grinder. */
  waitingTraySerial = '';
  private lastRequestedTray = '';
  /**
   * Another app (Cutter Builder's Waiting For Grinding list) opens the station with a tray. It is
   * scanned as if the operator had scanned it, once the grinder is known; nothing is started.
   */
  @Input() set requestedTray(value: string | null | undefined) {
    const serial = value?.trim().toUpperCase() ?? '';
    if (!serial || serial === this.lastRequestedTray) return;
    this.lastRequestedTray = serial;
    this.waitingTraySerial = serial;
    this.openRequestedTray();
  }
  private openRequestedTray(): void {
    const serial = this.waitingTraySerial;
    if (!serial || !this.grinder || this.busy) return;
    this.waitingTraySerial = '';
    this.scanTray(serial);
  }
  scanGrinder(number: string): void {
    const machine = this.grinders.find(machine => machine.machine_number.toUpperCase() === number.trim().toUpperCase());
    if (machine) this.selectGrinder(machine.id);
    else this.message = { tone: 'error', text: `No active grinder matches “${number.trim()}”. Check the number, or ask a supervisor to add it.` };
  }
  loadMachineHistory(): void {
    if (!this.grinder) return;
    const version = ++this.machineHistoryVersion;
    this.machineHistoryLoading = true; this.machineHistoryError = '';
    this.api.getMachineGrindingRuns(this.grinderId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: rows => { if (version !== this.machineHistoryVersion) return; this.machineHistory = rows; this.machineHistoryLoading = false; },
      error: error => { if (version !== this.machineHistoryVersion) return; this.machineHistoryLoading = false; this.machineHistoryError = apiErrorText(error, 'Could not load grinder history.'); },
    });
  }
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
  /** A full tray's set goes into a coater container by default, or stays in its tray. */
  packDestination: 'CONTAINER' | 'TRAY' = 'CONTAINER';
  /** Coater staging is the default location; a rough shelf bin is the alternative. */
  useRoughShelf = false;
  readonly stagingSerial = COATER_STAGING_LOCATION_SERIAL;
  emptyContainers: InventoryContainerRow[] = [];
  containerSerial = '';
  containersLoading = false;
  containersError = '';
  private containerRequestVersion = 0;
  /** The container the last completed pass went into, for the tray card. */
  lastPackedContainer = '';
  shelvesLoading = false;
  shelvesError = '';
  resolvedRequiredBlades: number | null = null;
  requirementLoading = false;
  requirementError = '';
  /** Result of the last scan or action. Errors stay on screen until the operator taps OK or acts again. */
  message: ScanMessage | null = null;

  get inProgress(): boolean { return Boolean(this.tray?.workflow_eligibility?.grinding); }
  stationActivated(): void { if (!this.busy) { this.refreshPickers(); this.refreshShelves(); this.refreshContainers(); } }
  get grinderOptions(): PickerOption[] { return this.grinders.map(machine => ({ value: machine.id, cells: [machine.machine_number, `Dept ${machine.department}`] })); }
  get trayOptions(): PickerOption[] {
    return this.filteredTrays.map(t => ({ value: t.serial_number, cells: [t.serial_number, t.current_location?.serial_number || t.current_stage?.name || 'Unassigned', `${t.blade_count} blades`] }));
  }
  get shelfOptions(): PickerOption[] {
    return this.matchingRoughShelves.map(shelf => ({ value: shelf.serial_number, cells: [shelf.serial_number, `${shelf.tray_count} trays`, `${shelf.blade_count} blades`] }));
  }
  get containerOptions(): PickerOption[] {
    return this.emptyContainers.map(container => ({ value: container.serial_number, cells: [container.serial_number, 'Empty'] }));
  }
  get hasSelectedContainer(): boolean { return this.emptyContainers.some(container => container.serial_number === this.containerSerial); }
  /** Where the tray (or its container) goes: the staging area unless a rough shelf bin is chosen. */
  get destinationLocation(): string { return this.useRoughShelf ? (this.roughShelfSerial || `${this.expectedShelfPrefix} shelf`) : this.stagingSerial; }
  get packingReady(): boolean {
    return (this.packDestination === 'TRAY' || (!this.containersLoading && this.hasSelectedContainer))
      && (!this.useRoughShelf || (!this.shelvesLoading && this.hasSelectedRoughShelf));
  }
  get primaryLabel(): string { return this.waitingToStart ? 'Start Grinding' : 'Complete Grinding'; }
  /** What the operator should do next, shown when there is no message. */
  get prompt(): string {
    if (this.busy) return 'Working…';
    if (!this.grinder || this.changingGrinder) {
      return this.waitingTraySerial
        ? `Scan or choose this workstation’s grinder. Tray ${this.waitingTraySerial} opens next.`
        : 'Scan or choose this workstation’s grinder.';
    }
    const tray = this.tray;
    if (!tray) return this.selectedTraySerial ? `Tray ${this.selectedTraySerial} did not load. Tap Retry, or scan the next tray.` : 'Scan the next tray for grinding.';
    if (!tray.workflow_eligibility?.grinding) return this.bladesShort > 0 ? `Tray ${tray.serial_number} needs ${this.bladesShort} replacement blade(s): add them on Blade Intake.` : 'Grinding recorded. Scan the next tray.';
    if (this.waitingToStart) return 'Tap Start Grinding when the tray goes on the grinder.';
    if (this.fullAfterGrinding && this.packDestination === 'CONTAINER' && !this.hasSelectedContainer) return 'Set the scrap count, then scan the empty coater container the blades go into.';
    if (this.fullAfterGrinding && this.useRoughShelf && !this.hasSelectedRoughShelf) return `Scan the ${this.expectedShelfPrefix} rough shelf bin, or go back to ${this.stagingSerial}.`;
    return 'Check the scrap count and summary, then tap Complete Grinding.';
  }
  /** Why the main button is not available, in operator terms. Empty when it is (or while working). */
  get recordBlockedReason(): string {
    const tray = this.tray;
    if (!tray || this.busy || this.canRecordGrinding || !tray.workflow_eligibility?.grinding) return '';
    if (!this.grinder) return 'Select this workstation’s grinder first.';
    if (!this.grinderMatchesTray) return `This pass was started on ${this.assignedGrinderNumber}. Select that grinder to complete it.`;
    if (this.waitingToStart) return '';
    if (this.completeLocked) return 'Grinding just started. Complete Grinding is ready in a moment; tap it when the pass is done.';
    if (this.pendingGrindingCount === 0) return 'No blades in this tray are waiting for grinding.';
    if (!this.grindingScrapValid) return `Scrap must be a whole number from 0 to ${this.pendingGrindingCount}.`;
    if (this.requirementLoading) return 'Loading the blade requirement…';
    if (this.requiredBlades === null) return this.requirementError || 'Blade requirement unavailable. Refresh the tray.';
    if (this.previouslyReadyCount + this.returnedAfterGrinding > this.requiredBlades) return 'Returned quantity would exceed the requirement. Refresh and review the tray.';
    if (this.fullAfterGrinding && this.packDestination === 'CONTAINER') {
      if (this.containersLoading) return 'Loading empty coater containers…';
      if (!this.hasSelectedContainer) return 'Scan the empty coater container the blades go into, or choose Stay in the tray.';
    }
    if (this.fullAfterGrinding && this.useRoughShelf) {
      if (this.shelvesLoading) return 'Loading rough shelves…';
      if (!this.hasSelectedRoughShelf) return `Scan the ${this.expectedShelfPrefix} rough shelf bin, or use ${this.stagingSerial}.`;
    }
    return '';
  }

  ngOnInit(): void { this.refreshGrinders(); this.refreshPickers(); this.refreshShelves(); this.refreshContainers(); }
  ngOnDestroy(): void { this.unlockComplete(); this.pickerVersion++; this.selectionVersion++; this.shelfRequestVersion++; this.containerRequestVersion++; this.destroyed$.next(); this.destroyed$.complete(); }
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
  /** The pass would leave the tray below its requirement, so it needs replacements and gets no shelf. */
  get shortAfterGrinding(): boolean {
    return this.requiredBlades !== null && this.previouslyReadyCount + this.returnedAfterGrinding < this.requiredBlades;
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
  /**
   * Complete Grinding appears where Start Grinding was. For a moment after a start it does not
   * respond, so a double tap on Start can never also complete the pass (with scrap 0).
   */
  completeLocked = false;
  private completeLockTimer: ReturnType<typeof setTimeout> | null = null;
  static readonly COMPLETE_LOCK_MS = 1500;
  private lockCompleteBriefly(): void {
    this.unlockComplete();
    this.completeLocked = true;
    this.completeLockTimer = setTimeout(() => this.unlockComplete(), GrindingComponent.COMPLETE_LOCK_MS);
  }
  private unlockComplete(): void {
    if (this.completeLockTimer) clearTimeout(this.completeLockTimer);
    this.completeLockTimer = null;
    this.completeLocked = false;
  }

  get canRecordGrinding(): boolean {
    return Boolean(this.grinder && this.grinderMatchesTray && !this.busy && this.tray?.workflow_eligibility?.grinding && (this.waitingToStart ||
      (this.tray.current_stage?.code === 'GRINDING' && !this.completeLocked && this.pendingGrindingCount > 0 && this.grindingScrapValid && !this.requirementLoading &&
       this.requiredBlades !== null && this.previouslyReadyCount + this.returnedAfterGrinding <= this.requiredBlades && (!this.fullAfterGrinding || this.packingReady))));
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
        this.autoSelectRoughShelf();
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
      this.message = { tone: 'error', text: `${serial} is not an enabled ${this.expectedShelfPrefix} shelf for this tray. Scan a ${this.expectedShelfPrefix} shelf bin, such as ${this.expectedShelfPrefix}-A1A (shelf, layer, bin).` };
      return;
    }
    this.message = null;
    this.roughShelfSerial = serial;
    this.roughShelfAutoSelected = false;
  }

  refreshContainers(): void {
    const request = ++this.containerRequestVersion;
    this.containersLoading = true; this.containersError = '';
    this.api.getWorkflowContainers('load').pipe(takeUntil(this.destroyed$)).subscribe({
      next: rows => {
        if (request !== this.containerRequestVersion) return;
        // A container takes one complete set, so only empty ones are offered.
        this.emptyContainers = rows.filter(container => !container.tray_count && !container.blade_set).sort((a, b) => a.serial_number.localeCompare(b.serial_number));
        this.containersLoading = false;
        if (!this.hasSelectedContainer) this.containerSerial = '';
      },
      error: e => {
        if (request !== this.containerRequestVersion) return;
        this.emptyContainers = []; this.containerSerial = ''; this.containersLoading = false;
        this.containersError = apiErrorText(e, 'Could not load empty coater containers.');
      },
    });
  }
  selectContainer(value: string): void {
    if (this.busy || this.containersLoading) return;
    const serial = value.trim().toUpperCase();
    this.containerSerial = '';
    if (!serial) return;
    if (!this.emptyContainers.some(container => container.serial_number === serial)) {
      this.message = { tone: 'error', text: `${serial} is not an empty, enabled coater container. A container takes one complete set; scan an empty one.` };
      return;
    }
    this.message = null;
    this.containerSerial = serial;
  }
  setPackDestination(destination: 'CONTAINER' | 'TRAY'): void {
    if (this.busy) return;
    this.packDestination = destination;
    this.message = null;
  }
  setUseRoughShelf(useRoughShelf: boolean): void {
    if (this.busy) return;
    this.useRoughShelf = useRoughShelf;
    if (!useRoughShelf) this.roughShelfSerial = '';
    this.message = null;
    if (useRoughShelf) this.autoSelectRoughShelf();
  }

  /** The rough bin was picked automatically: the only one holding the tray's Summary and part type. */
  roughShelfAutoSelected = false;
  /**
   * In rough-shelf mode, selects the bin by itself when exactly one rough bin for the tray's part
   * type holds its Summary. With two or more the operator scans or chooses one.
   */
  private autoSelectRoughShelf(): void {
    this.roughShelfAutoSelected = false;
    const tray = this.tray;
    if (!tray || !this.useRoughShelf || this.roughShelfSerial || this.shelvesLoading) return;
    const { shelf, matches } = autoShelfFor(this.matchingRoughShelves, tray.summary?.number, tray.part_type?.code);
    const holds = `Summary ${tray.summary?.number} ${tray.part_type?.code}`;
    if (shelf) {
      this.roughShelfSerial = shelf.serial_number;
      this.roughShelfAutoSelected = true;
      this.message = { tone: 'info', text: `${shelf.serial_number} selected automatically: the only rough shelf for ${holds}.` };
    } else if (matches.length > 1) {
      this.message = { tone: 'info', text: `${matches.length} rough shelves hold ${holds} (${matches.map((m) => m.serial_number).join(', ')}). Scan or choose one.` };
    }
  }

  private pickerVersion = 0;
  /** Only the newest list answer is shown: a slow earlier refresh never replaces a newer list. */
  refreshPickers(): void {
    const version = ++this.pickerVersion;
    this.pickerLoading=true; this.pickerError='';
    this.api.getWorkflowTrays('grinding').pipe(takeUntil(this.destroyed$)).subscribe({
      next: rows => { if (version !== this.pickerVersion) return; this.availableTrays=rows; this.pickerLoading=false; },
      error: e => { if (version !== this.pickerVersion) return; this.availableTrays=[]; this.pickerLoading=false; this.pickerError=apiErrorText(e,'Could not load trays available for grinding.'); },
    });
  }
  chooseTray(serial: string): void { this.scanTray(serial); }
  scanTray(serial: string): void { if(this.busy||!this.grinder||!serial.trim()) return; this.message=null; this.loadTray(serial.trim().toUpperCase(),true); }
  retryTray(): void { if(!this.selectedTraySerial||this.busy) return; this.loadTray(this.selectedTraySerial,false); }
  private loadTray(serial:string,checkEligibility:boolean):void {
    const version=++this.selectionVersion; this.selectedTraySerial=serial; this.roughShelfSerial=''; this.containerSerial=''; this.useRoughShelf=false; this.packDestination='CONTAINER'; if (checkEligibility) this.lastPackedContainer=''; this.resolvedRequiredBlades=null; this.requirementError=''; this.requirementLoading=false; this.busy=true; this.tray=null; this.grindingRuns=[]; this.historyLoading=true; this.historyError='';
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: tray => {
        if(version!==this.selectionVersion) return;
        if(!tray.workflow_eligibility?.grinding && checkEligibility){ this.tray=null; this.busy=false; this.historyLoading=false; this.message={tone:'error',text:`Tray ${serial} is not available for grinding. Check the tray number, or look it up in Find Inventory.`}; this.trayScanner?.select(); return; }
        this.tray=tray; this.busy=false; this.scrappedBladeCount=0; this.loadRequirement(tray,version);
        this.api.getTrayGrindingRuns(tray.id).pipe(takeUntil(this.destroyed$)).subscribe({
          next:runs=>{ if(version!==this.selectionVersion) return; this.grindingRuns=runs; this.historyLoading=false; },
          error:e=>{ if(version!==this.selectionVersion) return; this.historyLoading=false; this.historyError=apiErrorText(e,'Could not load grinding history.'); },
        });
      },
      error:e=>{ if(version!==this.selectionVersion) return; this.busy=false; this.historyLoading=false; this.message={tone:'error',text:apiErrorText(e,`Tray ${serial} could not be loaded.`)}; this.trayScanner?.select(); },
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
      this.api.startTrayGrinding(tray.id, this.grinderId).pipe(takeUntil(this.destroyed$)).subscribe({
        next:()=>{ this.lockCompleteBriefly(); this.toast.success(`Grinding started for ${serial}.`,'Grinding started'); this.message={tone:'success',text:`Grinding started for ${serial}. When the pass is done, scan it again to record scrap.`}; this.refreshPickers(); this.loadTray(serial,false); },
        error:e=>{ this.busy=false; this.message={tone:'error',text:apiErrorText(e,'Grinding was not started. Try again, or refresh the tray.')}; },
      }); return;
    }
    const summaryId=tray.summary_id??tray.summary?.id??''; const partTypeId=tray.part_type_id??tray.part_type?.id??'';
    if(!summaryId||!partTypeId){ this.busy=false; this.message={tone:'error',text:'Grinding was not recorded: this tray has no Part Summary / Part Type.'}; return; }
    const full=this.fullAfterGrinding;
    const packing = full ? { destination: this.packDestination, containerSerialNumber: this.containerSerial } : undefined;
    this.api.completeTrayGrinding(tray.id,summaryId,partTypeId,this.scrappedBladeCount,full && this.useRoughShelf ? this.roughShelfSerial : undefined, this.grinderId, packing).pipe(takeUntil(this.destroyed$)).subscribe({
      next:result=>{
        const base=`${result.scrapped_blade_count} scrapped; ${result.returned_blade_count} returned. Tray ${result.active_blade_count}/${result.required_blade_count}.`;
        this.lastPackedContainer = result.tray_emptied ? result.container_serial_number ?? '' : '';
        if(result.complete && result.tray_emptied) {
          const text=`${base} Put the blades in container ${result.container_serial_number} and take it to ${result.location_serial_number}. Tray ${serial} is empty and ready to reuse.`;
          this.toast.success(text,'Grinding complete'); this.message={tone:'success',text};
        }
        else if(result.complete) { const where=result.location_serial_number ?? result.rough_shelf_serial_number; this.toast.success(`${base} Tray to ${where}.`,'Grinding complete'); this.message={tone:'success',text:`${base} Take tray ${serial} to ${where}.`}; }
        else { this.toast.info(`${base} Add ${result.blades_needed} replacement blade(s) in Blade Intake.`,'Tray needs replacements'); this.message={tone:'info',text:`${base} Add ${result.blades_needed} replacement blade(s) on Blade Intake.`}; }
        this.loadMachineHistory();
        this.trayScanner?.clearAndFocus();
        this.refreshPickers(); this.refreshShelves(); this.refreshContainers(); this.loadTray(serial,false);
      },
      error:e=>{ this.busy=false; this.tray=null; this.roughShelfSerial=''; this.refreshPickers(); this.message={tone:'error',text:apiErrorText(e,'Grinding was not recorded. Scan the tray again before retrying.')}; },
    });
  }
}
