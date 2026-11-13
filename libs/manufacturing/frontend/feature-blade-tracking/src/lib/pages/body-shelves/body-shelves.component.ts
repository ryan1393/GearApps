import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { BladeTrackingApiService, EmptyBodyShelfView, apiErrorText } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearScannerFocusDirective, GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { DanaConfirmDialogComponent, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';

@Component({ selector:'gear-body-shelves', standalone:true,
  imports:[CommonModule, FormsModule, RouterLink, GearScannerFocusDirective, DanaConfirmDialogComponent, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective],
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
  /** A scanner ends each scan with Enter. After the body serial, move to the shelf field instead of submitting half a form. */
  bodyScanned(event:Event, shelfInput:HTMLInputElement):void {
    if(this.shelfSerial.trim())return;
    event.preventDefault();
    if(this.bodyIdentifier.trim())shelfInput.focus();
  }
  /** The placement or removal waiting for the operator to confirm it in the dialog. */
  confirmation: { kind:'place'; body:string; shelf:string } | { kind:'remove'; row:EmptyBodyShelfView } | null = null;
  get confirmationTitle():string { return this.confirmation?.kind==='remove' ? 'Remove shelf observation?' : 'Confirm empty body on shelf?'; }
  get confirmationMessage():string {
    const pending=this.confirmation;
    if(!pending) return '';
    return pending.kind==='place'
      ? `Confirm EMPTY cutter body ${pending.body} is physically on shelf ${pending.shelf}?`
      : `Remove the empty-body shelf observation for ${pending.row.body_serial}? This does not move or cancel a cutter build.`;
  }
  place():void {
    if(this.busy||this.loading||!this.bodyIdentifier.trim()||!this.shelfSerial.trim())return;
    this.confirmation={ kind:'place', body:this.bodyIdentifier.trim().toUpperCase(), shelf:this.shelfSerial.trim().toUpperCase() };
  }
  remove(row:EmptyBodyShelfView):void {
    if(this.busy||this.loading)return;
    this.confirmation={ kind:'remove', row };
  }
  confirm():void {
    const pending=this.confirmation;
    this.confirmation=null;
    if(!pending||this.busy||this.loading)return;
    if(pending.kind==='place') this.recordPlacement(pending.body,pending.shelf);
    else this.removeObservation(pending.row);
  }
  private recordPlacement(body:string, shelf:string):void {
    this.busy=true; this.error='';
    this.api.placeEmptyBodyShelf(body,shelf).pipe(takeUntil(this.destroyed$)).subscribe({next:()=>{this.busy=false;this.bodyIdentifier='';this.shelfSerial='';this.toast.success(`${body} recorded on ${shelf}.`,'Shelf recorded');this.refresh();},error:e=>{this.busy=false;this.error=apiErrorText(e,'Shelf placement was not recorded.');}});
  }
  private removeObservation(row:EmptyBodyShelfView):void {
    this.busy=true; this.error='';
    this.api.removeEmptyBodyShelf(row.body_serial,row.placement_id).pipe(takeUntil(this.destroyed$)).subscribe({next:()=>{this.busy=false;this.toast.success('Shelf observation removed; history retained.','Shelf removed');this.refresh();},error:e=>{this.busy=false;this.error=apiErrorText(e,'Could not remove this shelf observation.');}});
  }
}
