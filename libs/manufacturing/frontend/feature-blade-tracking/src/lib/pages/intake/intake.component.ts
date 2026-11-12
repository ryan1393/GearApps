import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { BladeStatus, IPartSummary, IPartType } from '@meshforge/manufacturing/shared/util-types';
import { BladeTrackingApiService, InventoryTrayRow, apiErrorText } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { ScanMessage } from '../../models/scan-message';
import { CountStepperComponent } from '../../shared/count-stepper/count-stepper.component';
import { OptionPickerComponent, PickerOption } from '../../shared/option-picker/option-picker.component';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import { StationStatusComponent } from '../../shared/station-status/station-status.component';
import { StationOperation } from '../operations-station/operations-station.operations';
import { DanaPageHeaderComponent } from '@dana/ui';

@Component({ selector:'gear-blade-intake', standalone:true,
  imports:[DanaPageHeaderComponent, CommonModule,FormsModule,RouterLink,ScanPanelComponent,StationStatusComponent,OptionPickerComponent,CountStepperComponent], templateUrl:'./intake.component.html',
  styles: [`
    #intake-batch { container-type: inline-size; }
    .intake-form-fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--dana-form-gap); }
    @container (min-width: 520px) {
      .intake-form-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `] })
export class IntakeComponent implements OnInit, OnDestroy, StationOperation {
  private readonly api=inject(BladeTrackingApiService);
  private readonly toast=inject(GearToastService);
  private readonly destroyed$=new Subject<void>();
  private selectionVersion=0;
  private requirementVersion=0;
  @ViewChild('summarySelect') summarySelect?:ElementRef<HTMLSelectElement>;
  @ViewChild('partTypeSelect') partTypeSelect?:ElementRef<HTMLSelectElement>;
  @ViewChild(CountStepperComponent) quantityInput?:CountStepperComponent;
  @ViewChild('trayScanner') trayScanner?:ScanPanelComponent;
  tray:InventoryTrayRow|null=null;
  availableTrays:InventoryTrayRow[]=[];
  selectedTraySerial=''; traySearch=''; pickerLoading=false; pickerError='';
  summaries:IPartSummary[]=[]; partTypes:IPartType[]=[];
  summaryId=''; partTypeId=''; quantity=1; requiredBlades:number|null=null;
  requirementError=''; requirementLoading=false; lookupsError='';
  status=BladeStatus.NEW; busy=false; refreshRequired=false;
  /** Result of the last scan or action. Errors stay on screen until the operator taps OK or acts again. */
  message:ScanMessage|null=null;
  get inProgress():boolean { return Boolean(this.tray); }
  stationActivated():void { if(!this.busy)this.refreshPickers(); }
  get trayOptions():PickerOption[] { return this.filteredTrays.map(t=>({value:t.serial_number,cells:[t.serial_number,t.current_stage?.name||'Empty',t.blade_count]})); }
  /** What the operator should do next, shown when there is no message. */
  get prompt():string {
    if(this.busy)return 'Working…';
    if(!this.tray)return this.refreshRequired?`Tray ${this.selectedTraySerial} could not be refreshed. Tap Retry.`:'Scan the intake tray, or choose it from the list.';
    if(this.trayFull)return `Tray ${this.tray.serial_number} is full. Next: record grinding on the Grinding tab.`;
    return 'Check Part Summary, Part Type and quantity, then tap Add Blade Batch.';
  }
  /** Why Add Blade Batch is not available, in operator terms. Empty when it is (or while working). */
  get addBlockedReason():string {
    const tray=this.tray;
    if(!tray||this.busy||this.canAddBladeBatch)return '';
    if(this.refreshRequired)return 'Retry the tray first: its contents could not be refreshed.';
    if(!tray.workflow_eligibility?.intake)return 'This tray is not available for Blade Intake.';
    if(!this.summaryId||!this.partTypeId)return 'Choose the Part Summary and Part Type.';
    if(this.requirementLoading)return 'Loading the blade requirement…';
    if(!this.requiredBlades)return this.requirementError||'No blade requirement is set for this Part Summary and Part Type.';
    if(this.trayFull)return 'This tray is full.';
    if(this.quantityProblem)return this.quantityProblem;
    if(tray.blade_count>0&&this.status===BladeStatus.WAITING_FOR_GRINDING)return 'Dull / waiting for grinding can only start an empty tray.';
    return '';
  }
  readonly statuses=[{value:BladeStatus.NEW,label:'New'}, {value:BladeStatus.GRINDING,label:'Grinding'}, {value:BladeStatus.WAITING_FOR_GRINDING,label:'Dull / waiting for grinding'}];
  ngOnInit():void {
    this.refreshPickers();
    this.api.getPartSummaries().pipe(takeUntil(this.destroyed$)).subscribe({next:x=>this.summaries=x.filter(row=>row.enabled),error:e=>this.lookupsError=apiErrorText(e,'Could not load Part Summaries. Reload this page to retry.')});
    this.api.getPartTypes().pipe(takeUntil(this.destroyed$)).subscribe({next:x=>this.partTypes=x.filter(p=>p.enabled&&['RING','PINION'].includes(p.code)),error:e=>this.lookupsError=apiErrorText(e,'Could not load Part Types. Reload this page to retry.')});
  }
  ngOnDestroy():void { this.selectionVersion++; this.requirementVersion++; this.destroyed$.next(); this.destroyed$.complete(); }
  get filteredTrays() { const q=this.traySearch.trim().toLowerCase(); return this.availableTrays.filter(t=>!q||t.serial_number.toLowerCase().includes(q)); }
  get canAddBladeBatch():boolean {
    return Boolean(!this.busy && !this.refreshRequired && !this.requirementLoading && this.requiredBlades &&
      this.tray?.workflow_eligibility?.intake && this.summaryId && this.partTypeId &&
      Number.isInteger(this.quantity) && this.quantity>=1 && this.quantity<=500 &&
      !(this.tray.blade_count>0 && this.status===BladeStatus.WAITING_FOR_GRINDING) &&
      (this.remainingCapacity===null || this.quantity<=this.remainingCapacity));
  }
  /** How many more blades this tray can take; null while the tray has no saved requirement (first fill). */
  get remainingCapacity():number|null {
    const required=this.tray?.required_blade_count;
    // An empty tray is reconfigured by the server on its next fill, so its old requirement is not a limit.
    return this.tray&&this.tray.blade_count>0&&required!=null ? Math.max(required-this.tray.blade_count,0) : null;
  }
  /** Why Add Blade Batch is unavailable, in operator terms. Empty when nothing needs explaining. */
  get quantityProblem():string {
    if(!this.tray)return '';
    if(!Number.isInteger(this.quantity)||this.quantity<1||this.quantity>500)return 'Quantity must be a whole number from 1 to 500.';
    const room=this.remainingCapacity;
    if(room!==null&&room>0&&this.quantity>room)return `This tray can take ${room} more blade(s) (${this.tray.blade_count} / ${this.tray.required_blade_count}).`;
    return '';
  }
  get trayFull():boolean { return this.remainingCapacity===0; }
  refreshPickers():void {
    this.pickerLoading=true; this.pickerError='';
    this.api.getWorkflowTrays('intake').pipe(takeUntil(this.destroyed$)).subscribe({next:r=>{this.availableTrays=r;this.pickerLoading=false;},error:e=>{this.availableTrays=[];this.pickerLoading=false;this.pickerError=apiErrorText(e,'Could not load eligible intake trays.');}});
  }
  chooseTray(serial:string):void { this.scanTray(serial); }
  scanTray(serial:string):void { if(this.busy||!serial.trim())return;this.quantity=1;this.loadTray(serial.trim().toUpperCase(),true); }
  retryTray():void { if(!this.busy&&this.selectedTraySerial)this.loadTray(this.selectedTraySerial,false); }
  private loadTray(serial:string,check:boolean,focusForm=true):void {
    const version=++this.selectionVersion; this.requirementVersion++; this.selectedTraySerial=serial;
    if(focusForm)this.message=null;
    this.busy=true; this.tray=null; this.requiredBlades=null; this.refreshRequired=false;
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next:tray=>{
        if(version!==this.selectionVersion)return;
        if(check&&!tray.workflow_eligibility?.intake){this.busy=false;this.message={tone:'error',text:`Tray ${serial} is not available for Blade Intake. Check the tray number, or find it on the Grinding tab.`};this.trayScanner?.select();return;}
        this.tray=tray;this.summaryId=tray.summary_id??'';this.partTypeId=tray.part_type_id??'';this.status=BladeStatus.NEW;this.busy=false;
        const room=this.remainingCapacity; if(room!==null&&room>0&&tray.blade_count>0)this.quantity=room;this.refreshRequiredBlades();if(focusForm)this.focusNextField(version);
      },
      error:e=>{if(version!==this.selectionVersion)return;this.busy=false;this.refreshRequired=true;this.message={tone:'error',text:apiErrorText(e,`Tray ${serial} could not be loaded.`)};this.trayScanner?.select();},
    });
  }
  /** After a tray loads, put the cursor on the first field that still needs input (the form renders on the next tick). */
  private focusNextField(version:number):void {
    setTimeout(()=>{
      if(version!==this.selectionVersion||!this.tray)return;
      const el=!this.summaryId?this.summarySelect?.nativeElement:!this.partTypeId?this.partTypeSelect?.nativeElement:this.quantityInput?.input; if(!el||el.disabled)return;
      el.focus(); if(el instanceof HTMLInputElement)el.select();
    });
  }
  refreshRequiredBlades():void {
    const version=++this.requirementVersion;
    const summaryId=this.summaryId; const partTypeId=this.partTypeId;
    this.requiredBlades=null; this.requirementError=''; this.requirementLoading=false;
    if(!summaryId||!partTypeId)return;
    this.requirementLoading=true;
    this.api.resolveBladeRequirement(summaryId,partTypeId).pipe(takeUntil(this.destroyed$)).subscribe({
      next:x=>{if(version!==this.requirementVersion)return;const n=Number(x.required_blade_count);this.requiredBlades=Number.isInteger(n)&&n>0?n:null;this.requirementLoading=false;if(!this.requiredBlades)this.requirementError='No positive blade requirement is configured for this pair.';},
      error:e=>{if(version!==this.requirementVersion)return;this.requirementLoading=false;this.requirementError=apiErrorText(e,'Could not load this Summary / Part Type blade requirement.');},
    });
  }
  create():void {
    const tray=this.tray;if(!tray||!this.canAddBladeBatch)return;const serial=tray.serial_number;this.busy=true;
    this.api.createBladeBatch({trayId:tray.id,summaryId:this.summaryId,partTypeId:this.partTypeId,quantity:this.quantity,status:this.status}).pipe(takeUntil(this.destroyed$)).subscribe({
      next:r=>{
        this.quantity=1;this.toast.success(`${r.quantity} blade(s) added to ${serial}.`,'Blades added');this.message={tone:'success',text:`${r.quantity} blade(s) added to ${serial}. Record grinding on the Grinding tab.`};this.refreshPickers();
        // The batch is saved. Put the cursor back in the scan box: left in Quantity, the next
        // tray scan would type its digits there and its Enter would add blades to this tray again.
        this.trayScanner?.clearAndFocus();
        this.loadTray(serial,false,false);
      },
      error:e=>{this.busy=false;this.refreshRequired=true;this.message={tone:'error',text:apiErrorText(e,'Blades were not added. Tap Retry to refresh the tray, then try again.')};this.refreshPickers();},
    });
  }
}
