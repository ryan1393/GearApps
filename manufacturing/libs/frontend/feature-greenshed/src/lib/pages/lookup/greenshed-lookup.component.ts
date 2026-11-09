import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { GreenshedApiService, GreenshedBuild, GreenshedHistoryEvent, GreenshedSearchRow, greenshedApiErrorText } from '@libs/frontend/data-access-greenshed';
import {
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';

@Component({selector:'gear-greenshed-lookup',standalone:true,imports: [CommonModule, FormsModule, DanaPageHeaderComponent, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],templateUrl:'./greenshed-lookup.component.html'})
export class GreenshedLookupComponent implements OnInit {
 private readonly api=inject(GreenshedApiService);private readonly route=inject(ActivatedRoute);q='';status='';rows:GreenshedSearchRow[]=[];build:GreenshedBuild|null=null;history:GreenshedHistoryEvent[]=[];busy=false;error='';
 readonly statuses=['','READY','RUNNING','SHELF','PULLED'];
 ngOnInit(){const build=this.route.snapshot.queryParamMap.get('build')?.trim();if(build){this.q=build;this.open(build);}else{this.search();}}
 search(){this.busy=true;this.error='';this.build=null;this.api.searchBuilds(this.q,this.status).subscribe({next:r=>{this.rows=r;this.busy=false;},error:(e:HttpErrorResponse)=>{this.busy=false;this.error=greenshedApiErrorText(e,'Search failed.');}});}
 open(buildNumber:string){this.busy=true;this.error='';this.history=[];this.api.getBuild(buildNumber).subscribe({next:b=>{this.build=b;this.api.getHistory(buildNumber).subscribe({next:h=>{this.history=h;this.busy=false;},error:(e:HttpErrorResponse)=>{this.busy=false;this.error=greenshedApiErrorText(e,'Build details loaded, but cutter history could not be loaded.');}});},error:(e:HttpErrorResponse)=>{this.busy=false;this.error=greenshedApiErrorText(e,'Build not found.');}});}
}
