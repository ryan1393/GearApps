import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { BladeTrackingApiService, EmptyBodyShelfView, apiErrorText } from '@libs/frontend/data-access-blade-tracking';
import { GearToastService } from '@libs/frontend/util-common';
import { DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';

@Component({ selector:'gear-body-shelves', standalone:true,
  imports:[CommonModule, FormsModule, RouterLink, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective],
  templateUrl:'./body-shelves.component.html' })
export class BodyShelvesComponent implements OnInit, OnDestroy {
  private readonly api=inject(BladeTrackingApiService);
  private readonly toast=inject(GearToastService);
  private readonly destroyed$=new Subject<void>();
  rows:EmptyBodyShelfView[]=[]; bodyIdentifier=''; shelfSerial=''; search=''; error=''; busy=false; loading=false;
  ngOnInit():void { this.refresh(); }
  ngOnDestroy():void { this.destroyed$.next(); this.destroyed$.complete(); }
  get filteredRows():EmptyBodyShelfView[] { const q=this.search.trim().toUpperCase(); return this.rows.filter(r=>!q || (r.body_serial+' '+r.shelf_serial+' '+r.state).toUpperCase().includes(q)); }
  refresh():void { if(this.loading) return; this.loading=true; this.error=''; this.api.getEmptyBodyShelves().pipe(takeUntil(this.destroyed$)).subscribe({next:r=>{this.rows=r;this.loading=false;},error:e=>{this.rows=[];this.loading=false;this.error=apiErrorText(e,'Could not load empty-body shelves.');}}); }
  place():void {
    if(this.busy||this.loading||!this.bodyIdentifier.trim()||!this.shelfSerial.trim())return;
    const body=this.bodyIdentifier.trim().toUpperCase(); const shelf=this.shelfSerial.trim().toUpperCase();
    if(!globalThis.confirm(`Confirm EMPTY cutter body ${body} is physically on shelf ${shelf}?`))return;
    this.busy=true; this.error='';
    this.api.placeEmptyBodyShelf(body,shelf).pipe(takeUntil(this.destroyed$)).subscribe({next:()=>{this.busy=false;this.bodyIdentifier='';this.shelfSerial='';this.toast.success(`${body} recorded on ${shelf}.`,'Shelf recorded');this.refresh();},error:e=>{this.busy=false;this.error=apiErrorText(e,'Shelf placement was not recorded.');}});
  }
  remove(row:EmptyBodyShelfView):void {
    if(this.busy||this.loading||!globalThis.confirm(`Remove the empty-body shelf observation for ${row.body_serial}? This does not move or cancel a cutter build.`))return;
    this.busy=true; this.error='';
    this.api.removeEmptyBodyShelf(row.body_serial,row.placement_id).pipe(takeUntil(this.destroyed$)).subscribe({next:()=>{this.busy=false;this.toast.success('Shelf observation removed; history retained.','Shelf removed');this.refresh();},error:e=>{this.busy=false;this.error=apiErrorText(e,'Could not remove this shelf observation.');}});
  }
}
