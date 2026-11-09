import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GearToastService } from '@gearapps/manufacturing/frontend/util-common';
import { BladeStatus, IPartSummary, IPartType } from '@gearapps/manufacturing/shared/util-types';
import { BladeTrackingApiService, InventoryTrayRow, apiErrorText } from '@gearapps/manufacturing/frontend/data-access-blade-tracking';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import { DanaPageHeaderComponent } from '@dana/ui';

@Component({ selector:'gear-blade-intake', standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,ScanPanelComponent,DanaPageHeaderComponent], templateUrl:'./intake.component.html' })
export class IntakeComponent implements OnInit, OnDestroy {
  private readonly api=inject(BladeTrackingApiService);
  private readonly toast=inject(GearToastService);
  private readonly destroyed$=new Subject<void>();
  private selectionVersion=0;
  private requirementVersion=0;
  @ViewChild('summarySelect') summarySelect?:ElementRef<HTMLSelectElement>;
  @ViewChild('partTypeSelect') partTypeSelect?:ElementRef<HTMLSelectElement>;
  @ViewChild('quantityInput') quantityInput?:ElementRef<HTMLInputElement>;
  tray:InventoryTrayRow|null=null;
  availableTrays:InventoryTrayRow[]=[];
  selectedTraySerial=''; traySearch=''; pickerLoading=false; pickerError='';
  summaries:IPartSummary[]=[]; partTypes:IPartType[]=[];
  summaryId=''; partTypeId=''; quantity=1; requiredBlades:number|null=null;
  requirementError=''; requirementLoading=false; lookupsError='';
  status=BladeStatus.NEW; busy=false; refreshRequired=false;
  readonly statuses=[{value:BladeStatus.NEW,label:'new'}, {value:BladeStatus.GRINDING,label:'grinding'}, {value:BladeStatus.WAITING_FOR_GRINDING,label:'dull / waiting for grinding'}];
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
      (this.tray.required_blade_count==null || this.tray.blade_count+this.quantity<=this.tray.required_blade_count));
  }
  refreshPickers():void {
    this.pickerLoading=true; this.pickerError='';
    this.api.getWorkflowTrays('intake').pipe(takeUntil(this.destroyed$)).subscribe({next:r=>{this.availableTrays=r;this.pickerLoading=false;},error:e=>{this.availableTrays=[];this.pickerLoading=false;this.pickerError=apiErrorText(e,'Could not load eligible intake trays.');}});
  }
  chooseTray(serial:string):void { this.scanTray(serial); }
  scanTray(serial:string):void { if(this.busy||!serial.trim())return;this.loadTray(serial.trim().toUpperCase(),true); }
  retryTray():void { if(!this.busy&&this.selectedTraySerial)this.loadTray(this.selectedTraySerial,false); }
  private loadTray(serial:string,check:boolean):void {
    const version=++this.selectionVersion; this.requirementVersion++; this.selectedTraySerial=serial;
    this.busy=true; this.tray=null; this.requiredBlades=null; this.refreshRequired=false;
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next:tray=>{
        if(version!==this.selectionVersion)return;
        if(check&&!tray.workflow_eligibility?.intake){this.busy=false;this.toast.error(`Tray ${serial} is not currently available for Blade Intake.`,'Intake unavailable');return;}
        this.tray=tray;this.summaryId=tray.summary_id??'';this.partTypeId=tray.part_type_id??'';this.status=BladeStatus.NEW;this.busy=false;this.refreshRequiredBlades();this.focusNextField(version);
      },
      error:e=>{if(version!==this.selectionVersion)return;this.busy=false;this.refreshRequired=true;this.toast.error(apiErrorText(e,'Could not refresh tray.'),'Tray lookup failed');},
    });
  }
  /** After a tray loads, put the cursor on the first field that still needs input (the form renders on the next tick). */
  private focusNextField(version:number):void {
    setTimeout(()=>{
      if(version!==this.selectionVersion||!this.tray)return;
      const target=!this.summaryId?this.summarySelect:!this.partTypeId?this.partTypeSelect:this.quantityInput;
      const el=target?.nativeElement; if(!el||el.disabled)return;
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
      next:r=>{this.quantity=1;this.toast.success(`${r.quantity} blade(s) added to ${serial}. Use the Grinding screen for disposition.`,'Blades added');this.refreshPickers();this.loadTray(serial,false);},
      error:e=>{this.busy=false;this.refreshRequired=true;this.toast.error(apiErrorText(e,'Could not add blades. Refresh the tray before retrying.'),'Add blades failed');this.refreshPickers();},
    });
  }
}
