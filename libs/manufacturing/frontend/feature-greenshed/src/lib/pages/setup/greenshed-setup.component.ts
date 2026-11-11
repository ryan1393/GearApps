import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import {
  GreenshedApiService,
  GreenshedBuild,
  GreenshedMachine,
  GreenshedSetupResult,
  PartMasterRow,
  greenshedApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import {
  DanaPageHeaderComponent,
  DanaButtonDirective,
} from '@dana/ui';

@Component({selector:'gear-greenshed-setup',standalone:true,imports: [CommonModule, FormsModule, DanaPageHeaderComponent, DanaButtonDirective],templateUrl:'./greenshed-setup.component.html'})
export class GreenshedSetupComponent {
  private readonly api=inject(GreenshedApiService); private readonly route=inject(ActivatedRoute); private readonly http=inject(HttpClient); private readonly toast=inject(GearToastService);
  private readonly destroyRef=inject(DestroyRef);
  private selectedMachineNumber='';
  private buildRequest=0; private machineRequest=0; private partRequest=0; private choicesRequest=0;
  buildNumber='';machineNumber='';partNumber='';startingPieceCount=0;comments='';
  availableBuilds:Array<Pick<GreenshedBuild,'build_number'|'summary_number'|'part_type_code'>>=[];
  /** Which pick lists failed to load; a failed load must not read as "nothing configured". */
  choiceErrors={builds:false,machines:false,parts:false};
  availableMachineNumbers:string[]=[];
  availableParts:PartMasterRow[]=[];
  build:GreenshedBuild|null=null;part:PartMasterRow|null=null;machine:GreenshedMachine|null=null;busy=false;error='';message='';result:GreenshedSetupResult|null=null;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params=>{
      this.buildRequest++;
      this.selectedMachineNumber=params.get('origin')==='running-machines' ? params.get('machine')?.trim()??'' : '';
      this.startAnother();
      this.machineNumber=this.selectedMachineNumber || params.get('machine')?.trim() || '';
      this.loadSetupChoices();
    });
  }

  get machineLocked():boolean { return !!this.selectedMachineNumber; }

  /** The count a shelf cutter resumes from, or null for a cutter new to a machine. */
  get carriedPieceCount():number|null {
    const count=this.build?.status_code==='SHELF' ? this.build.changeover_piece_count : null;
    return typeof count==='number' ? count : null;
  }

  get choicesFailed():boolean { return this.choiceErrors.builds||this.choiceErrors.machines||this.choiceErrors.parts; }

  reloadChoices():void { if(!this.busy)this.loadSetupChoices(); }

  private loadSetupChoices():void {
    const request=++this.choicesRequest;
    this.choiceErrors={builds:false,machines:false,parts:false};
    // The dashboard lists every READY/SHELF build. The general build search returns only the
    // newest 100 open builds of any status, which pushed older shelf stock out of this picker.
    this.api.getDashboard().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:dashboard=>{if(request!==this.choicesRequest)return;this.availableBuilds=[...dashboard.available_cutters]
        .sort((a,b)=>a.build_number.localeCompare(b.build_number));},
      error:()=>{if(request===this.choicesRequest){this.availableBuilds=[];this.choiceErrors.builds=true;}}
    });
    this.api.getRunningMachines('ALL').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:board=>{
        if(request!==this.choicesRequest)return;
        const requiredDepartment=this.build?.part_type_code==='RING'
          ? '152'
          : this.build?.part_type_code==='PINION'
            ? '132'
            : '';
        this.availableMachineNumbers=board.departments
          .filter(department=>!requiredDepartment || department.department_code===requiredDepartment)
          .flatMap(department=>department.machines)
          .filter(machine=>machine.machine_active && !machine.has_cutter)
          .map(machine=>machine.machine_number)
          .filter((value,index,all)=>all.indexOf(value)===index)
          .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
      },
      error:()=>{if(request===this.choicesRequest){this.availableMachineNumbers=[];this.choiceErrors.machines=true;}}
    });
    this.http.get<PartMasterRow[]>('/api/v1/parts?active=ALL').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:parts=>{if(request!==this.choicesRequest)return;this.availableParts=parts
        .filter(row=>row.active && row.enabled)
        .sort((a,b)=>a.part_number.localeCompare(b.part_number,undefined,{numeric:true}));},
      error:()=>{if(request===this.choicesRequest){this.availableParts=[];this.choiceErrors.parts=true;}}
    });
  }

  get matchingParts():PartMasterRow[] {
    if(!this.build) return [];
    return this.availableParts.filter(row=>
      row.summary?.number===this.build?.summary_number &&
      row.part_type?.code===this.build?.part_type_code
    );
  }

  get selectedRollMaster():PartMasterRow['roll_master'] { return this.part?.roll_master ?? null; }
  get rollMasterMinimumQuantity():number {
    const row=this.selectedRollMaster; return row?.minimum_quantity ?? row?.required_count ?? 0;
  }
  get rollMasterCurrentQuantity():number { return this.selectedRollMaster?.current_quantity ?? 0; }
  get rollMasterLow():boolean {
    const row=this.selectedRollMaster; const minimum=this.rollMasterMinimumQuantity;
    return !!row?.active && !!row?.enabled && minimum>0 && this.rollMasterCurrentQuantity<=minimum;
  }

  selectBuild():void {
    if(this.busy)return;
    if(!this.buildNumber){this.buildRequest++;this.choicesRequest++;this.build=null;this.busy=false;this.error='';this.resetSetupDownstream();this.availableMachineNumbers=[];return;}
    this.scanBuild();
  }

  selectMachine():void {
    if(this.busy)return;
    if(!this.machineNumber){this.machineRequest++;this.machine=null;return;}
    this.scanMachine();
  }

  selectPart():void {
    if(this.busy)return;
    if(!this.partNumber){this.partRequest++;this.part=null;return;}
    this.scanPart();
  }

  scanBuild(){
    if(this.busy)return;
    const requested=this.buildNumber.trim(); if(!requested)return;
    const request=++this.buildRequest;
    this.build=null;this.resetSetupDownstream();this.busy=true;this.error='';this.message='';
    this.api.getBuild(requested).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:b=>{
        if(request!==this.buildRequest)return;
        this.build=b;this.buildNumber=b.build_number;this.busy=false;this.loadSetupChoices();
        // An intact cutter returning from a Greenshed shelf continues the count of its last run; the API enforces it.
        this.startingPieceCount=this.carriedPieceCount ?? 0;
        if(!['READY','SHELF'].includes(b.status_code)){this.error=`Build ${b.build_number} is ${b.status_code} and cannot be setup.`;return;}
        if(this.machineLocked)this.scanMachine();
      },
      error:(e:HttpErrorResponse)=>{if(request!==this.buildRequest)return;this.busy=false;this.error=greenshedApiErrorText(e,'Build not found.');}
    });
  }

  scanMachine(){
    if(this.busy)return;
    if(!this.build||!this.machineNumber.trim())return;
    const request=++this.machineRequest;
    const build=this.build;
    const requested=this.selectedMachineNumber || this.machineNumber.trim();
    this.busy=true;this.error='';this.machine=null;
    this.api.getMachine(requested).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:m=>{
      if(request!==this.machineRequest||build!==this.build)return;
      this.busy=false;this.machineNumber=this.selectedMachineNumber || m.machine_number;
      if(!m.machine_active){this.error=`Machine ${m.machine_number} is inactive.`;return;}
      if(m.active_run){this.error=`Machine ${m.machine_number} already has cutter ${m.active_run.build_number} running.`;return;}
      const requiredDepartment=build.part_type_code==='RING'?'152':build.part_type_code==='PINION'?'132':'';
      if(!requiredDepartment||m.department_code!==requiredDepartment){this.error=`${build.part_type_code} Cutter Build ${build.build_number} cannot run on machine ${m.machine_number}. Select a compatible cutter build.`;return;}
      this.machine=m;
    },error:(e:HttpErrorResponse)=>{if(request!==this.machineRequest)return;this.busy=false;this.error=greenshedApiErrorText(e,'Machine not found.');}});
  }

  scanPart(){
    if(this.busy)return;
    if(!this.build||!this.partNumber.trim())return;
    const request=++this.partRequest;
    const build=this.build;
    this.busy=true;this.error='';this.part=null;
    this.api.getPartByNumber(this.partNumber).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:p=>{if(request!==this.partRequest||build!==this.build)return;this.partNumber=p.part_number;this.busy=false;if(!p.active){this.error=`Part ${p.part_number} is inactive.`;return;}if(p.summary?.number!==this.build?.summary_number||p.part_type?.code!==this.build?.part_type_code){this.error=`Part ${p.part_number} does not match Cutter Build ${this.build?.build_number}.`;return;}this.part=p;},error:(e:HttpErrorResponse)=>{if(request!==this.partRequest)return;this.busy=false;this.error=greenshedApiErrorText(e,'Part not found.');}});
  }

  setup(){
    if(this.busy||!this.build||!this.machine||!this.part||!['READY','SHELF'].includes(this.build.status_code))return;
    if(!Number.isSafeInteger(this.startingPieceCount)||this.startingPieceCount<0){this.error='Enter a non-negative whole starting piece count.';return;}
    const request=this.buildRequest;
    this.busy=true;this.error='';this.message='';
    this.api.setupCutter({buildNumber:this.build.build_number,machineNumber:this.machine.machine_number,partNumber:this.part.part_number,shift:'',startingPieceCount:this.startingPieceCount,comments:this.comments}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:r=>{if(request!==this.buildRequest)return;this.result=r;this.busy=false;const message=`${r.build_number} setup on ${r.machine_number}.`;this.message='';this.toast.success(message,'Cutter setup complete');},error:(e:HttpErrorResponse)=>{if(request!==this.buildRequest)return;this.busy=false;const message=greenshedApiErrorText(e,'Could not setup cutter.');this.error='';this.toast.error(message,'Cutter setup failed');}});
  }

  startAnother(){
    this.buildRequest++;this.choicesRequest++;this.busy=false;
    this.buildNumber='';this.build=null;this.resetSetupDownstream();this.startingPieceCount=0;this.comments='';this.result=null;this.error='';this.message='';
  }

  /** After a completed setup the machine now has a cutter: release a machine locked from the board and reload every list. */
  setupAnother(){
    this.selectedMachineNumber='';
    this.startAnother();
    this.loadSetupChoices();
  }

  private resetSetupDownstream(){
    this.machineRequest++;this.partRequest++;this.machineNumber=this.selectedMachineNumber;
    this.machine=null;this.part=null;this.partNumber='';this.result=null;
  }
}
