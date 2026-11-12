import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { GreenshedApiService, GreenshedBuild, GreenshedHistoryEvent, GreenshedSearchRow, greenshedApiErrorText } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import {
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaToneDirective,
} from '@dana/ui';

@Component({selector:'gear-greenshed-lookup',standalone:true,imports: [DanaToneDirective, CommonModule, FormsModule, DanaPageHeaderComponent, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],templateUrl:'./greenshed-lookup.component.html'})
export class GreenshedLookupComponent implements OnInit {
 private readonly api=inject(GreenshedApiService);private readonly route=inject(ActivatedRoute);private readonly destroyRef=inject(DestroyRef);private request=0;q='';status='';rows:GreenshedSearchRow[]=[];build:GreenshedBuild|null=null;history:GreenshedHistoryEvent[]=[];busy=false;error='';historyFailed=false;
 readonly statuses=['','READY','RUNNING','SHELF','PULLED'];
 // The top-bar search navigates here with ?build=<text> even when this page is already open,
 // so follow the query string instead of reading it once.
 ngOnInit(){this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(queryParamMap=>{const text=queryParamMap.get('build')?.trim();if(text){this.q=text;this.open(text,true);}else{this.search();}});}
 search(){const request=++this.request;this.busy=true;this.error='';this.build=null;this.history=[];this.historyFailed=false;this.api.searchBuilds(this.q,this.status).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:r=>{if(request!==this.request)return;this.rows=r;this.busy=false;},error:(e:HttpErrorResponse)=>{if(request!==this.request)return;this.busy=false;this.error=greenshedApiErrorText(e,'Search failed.');}});}
 /** Open one build. `searchIfMissing`: the text came from the search box and may be a body serial or Summary rather than a build number. */
 open(buildNumber:string,searchIfMissing=false){const request=++this.request;this.busy=true;this.error='';this.build=null;this.history=[];this.historyFailed=false;this.api.getBuild(buildNumber).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:b=>{if(request!==this.request)return;this.build=b;this.api.getHistory(buildNumber).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:h=>{if(request!==this.request)return;this.history=h;this.busy=false;},error:(e:HttpErrorResponse)=>{if(request!==this.request)return;this.busy=false;this.historyFailed=true;this.error=greenshedApiErrorText(e,'Build details loaded, but cutter history could not be loaded.');}});},error:(e:HttpErrorResponse)=>{if(request!==this.request)return;if(searchIfMissing&&e.status===404){this.openMachineOrSearch(buildNumber);return;}this.busy=false;this.error=greenshedApiErrorText(e,'Build not found.');}});}
 /** Not a build number: a machine number opens the cutter running on it; anything else is searched as body serial or Summary. */
 private openMachineOrSearch(text:string){const request=++this.request;this.api.getMachine(text).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:machine=>{if(request!==this.request)return;const running=machine.active_run?.build_number;if(running)this.open(running);else this.search();},error:()=>{if(request===this.request)this.search();}});}
 back(){this.build=null;this.search();}
}
