import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subject, takeUntil } from 'rxjs';
import { v4 as uuid } from 'uuid';
import { CoaterAvailableContainer, CoaterShipment, CoaterShipmentContainer, CoaterShipmentList } from '@libs/shared/util-types';
import { CoaterShipmentsApiService, apiErrorText } from '@libs/frontend/data-access-blade-tracking';
import { DanaPageHeaderComponent } from '@dana/ui';
import { coaterPackingSlipHtml, coaterContainerLabelsHtml } from './coater-packing-slip';

@Component({
  selector: 'gear-coater-shipments', standalone: true,
  imports: [CommonModule,FormsModule,RouterLink,DanaPageHeaderComponent],
  templateUrl: './coater-shipments.component.html', styleUrls: ['./coater-shipments.component.css'],
})
export class CoaterShipmentsComponent implements OnDestroy {
  private readonly api = inject(CoaterShipmentsApiService);
  private readonly destroy$ = new Subject<void>();
  @ViewChild('scanner') scanner?: ElementRef<HTMLInputElement>;
  active: CoaterShipment | null = null;
  list: CoaterShipmentList = { rows: [], total: 0, page: 1, page_size: 25 };
  tab = 'open'; query = ''; page = 1;
  destination = 'Coater'; notes = ''; serial = ''; availableQuery = '';
  availableContainers: CoaterAvailableContainer[] = []; availableLoading = false; availableError = ''; selectedContainer = ''; 
  busy = false; loadingList = false; stale = false;
  error = ''; notice = ''; listError = '';
  confirmSend = false; checked = false; cancelOpen = false; cancelReason = '';
  undoSerial = '';
  private requestId = uuid();
  private listVersion = 0;
  constructor() { this.refreshList(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  get dirty() { return !!this.active && (this.destination.trim()!==this.active.destination || this.notes.trim()!==this.active.notes); }
  get canEdit() { return this.active?.status==='DRAFT' && !this.busy && !this.stale; }
  get canReview() { return this.canEdit && !this.dirty && !!this.active?.manifest.totals.containers && !this.active.manifest.issues.length; }
  get canPrint() { return !!this.active && this.active.status!=='CANCELED' && !this.busy && !this.stale && !this.dirty && (this.active.status==='DISPATCHED' || this.active.reviewed); }
  get canSend() { return this.canReview && this.active!.reviewed && this.active!.print_requested; }
  time(value: string) { return new Intl.DateTimeFormat('en-US',{timeZone:'America/Indiana/Indianapolis',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
  focus() { queueMicrotask(()=>this.scanner?.nativeElement.focus()); }
  refreshList() {
    const version=++this.listVersion; this.loadingList=true; this.listError='';
    this.api.list(this.tab,this.query,this.page).pipe(takeUntil(this.destroy$)).subscribe({next:r=>{if(version!==this.listVersion)return;this.list=r;this.loadingList=false;},error:e=>{if(version!==this.listVersion)return;this.listError=apiErrorText(e,'Could not load shipments.');this.list={rows:[],total:0,page:this.page,page_size:25};this.loadingList=false;}});
  }
  changeTab(tab: string) { if(this.busy)return;this.tab=tab;this.page=1;this.refreshList(); }
  search() { this.page=1;this.refreshList(); }
  paginate(delta: number) { this.page+=delta;this.refreshList(); }
  private accept(s: CoaterShipment) {
    this.active=s;this.destination=s.destination;this.notes=s.notes;this.stale=false;
    this.confirmSend=false;this.checked=false;this.cancelOpen=false;this.cancelReason='';
    if(s.status==='DRAFT') this.refreshAvailable(); else this.availableContainers=[];
  }
  private act(request: Observable<CoaterShipment>, success: string, done?: ()=>void) {
    if(this.busy)return;this.busy=true;this.error='';this.notice='';
    request.pipe(takeUntil(this.destroy$)).subscribe({next:s=>{this.accept(s);this.busy=false;this.notice=success;done?.();this.refreshList();this.focus();},error:e=>{this.busy=false;this.confirmSend=false;this.checked=false;this.error=apiErrorText(e,'The request could not be confirmed. Refresh the shipment before continuing.');if(this.active)this.stale=true;}});
  }
  start() { if(this.busy || this.active || !this.destination.trim())return;this.act(this.api.create(this.requestId,this.destination,this.notes),'Shipment started. Scan packed containers.',()=>{this.requestId=uuid();this.undoSerial='';}); }
  open(id: string) { if(this.busy)return;this.undoSerial='';this.act(this.api.get(id),'Shipment loaded.'); }
  refresh() { if(this.active)this.open(this.active.id);else this.refreshList(); }
  close() { if(this.busy)return;this.active=null;this.error='';this.notice='';this.undoSerial='';this.destination='Coater';this.notes='';this.stale=false;this.confirmSend=false;this.cancelOpen=false;this.refreshList(); }
  refreshAvailable() {
    const s=this.active;if(!s || s.status!=='DRAFT'){this.availableContainers=[];return;}
    this.availableLoading=true;this.availableError='';
    this.api.available(s.id,this.availableQuery).pipe(takeUntil(this.destroy$)).subscribe({next:rows=>{this.availableContainers=rows;this.availableLoading=false;if(this.selectedContainer && !rows.some(r=>r.serial===this.selectedContainer))this.selectedContainer='';},error:e=>{this.availableContainers=[];this.availableLoading=false;this.availableError=apiErrorText(e,'Could not load available containers.');}});
  }
  chooseAvailable() {
    if(!this.selectedContainer || !this.active || !this.canEdit || this.dirty)return;
    this.serial=this.selectedContainer;this.scan();
  }
  availableLabel(c: CoaterAvailableContainer) {
    const mix=c.summary.map(x=>`${x.summary} ${x.part_type}`).slice(0,3).join(', ');
    return `${c.serial} — ${c.trays} trays / ${c.blades} blades${mix ? ' — '+mix : ''}`;
  }
  scan() {
    const s=this.active, serial=this.serial.trim().toUpperCase();
    if(!s || !this.canEdit || this.dirty || !serial)return;
    if(s.manifest.containers.some(c=>c.serial===serial)){this.notice=`${serial} is already in this shipment.`;this.serial='';this.focus();return;}
    this.act(this.api.add(s,serial),`${serial} added.`,()=>{this.serial='';this.undoSerial='';});
  }
  remove(c: CoaterShipmentContainer) { if(this.active && this.canEdit && !this.dirty)this.act(this.api.remove(this.active,c.id),`${c.serial} removed from the shipment; its trays stay packed.`,()=>this.undoSerial=c.serial); }
  undo() { if(this.active && this.canEdit && this.undoSerial && !this.dirty){const serial=this.undoSerial;this.act(this.api.add(this.active,serial),`${serial} restored.`,()=>this.undoSerial='');} }
  save() { if(this.active && this.canEdit && this.dirty)this.act(this.api.update(this.active,this.destination,this.notes),'Details saved. Review and print the current revision.'); }
  review() { if(this.active && this.canReview)this.act(this.api.review(this.active),'All containers validated. Review the totals and print this revision.'); }
  print(labels = false) {
    const s=this.active;if(!s || !this.canPrint)return;
    const popup=window.open('','_blank');
    if(!popup){this.error='Allow pop-ups for this site, then select Print again.';return;}
    popup.opener=null;popup.document.title='Preparing packing slip';popup.document.body.textContent='Preparing the packing slip…';
    this.busy=true;this.error='';this.notice='';
    (labels ? this.api.labels(s) : this.api.print(s)).pipe(takeUntil(this.destroy$)).subscribe({next:slip=>{
      this.accept(slip.shipment);this.busy=false;
      try {
        if(popup.closed)throw new Error('The print window was closed. Select Print again.');
        popup.document.open();popup.document.write(labels ? coaterContainerLabelsHtml(slip) : coaterPackingSlipHtml(slip));popup.document.close();
        popup.document.getElementById('print-slip')?.addEventListener('click',()=>popup.print());
        popup.focus();popup.print();this.notice=labels ? 'Container labels opened on 4 × 6 pages. Print the combined packing slip before sending.' : 'Packing slip opened. Confirm the printed copy and physical containers before sending.';
      } catch(e) { this.error=e instanceof Error?e.message:'Could not open the print dialog. Select Print again.'; }
    },error:e=>{popup.close();this.busy=false;this.stale=true;this.error=apiErrorText(e,'Could not prepare the slip. Refresh before printing again.');}});
  }
  askSend() { if(this.canSend){this.checked=false;this.confirmSend=true;this.cancelOpen=false;} }
  send() { if(this.active && this.canSend && this.confirmSend && this.checked)this.act(this.api.dispatch(this.active),'Shipment sent to the coater. Contents are locked.',()=>this.undoSerial=''); }
  cancel() { if(this.active && this.canEdit && this.cancelReason.trim())this.act(this.api.cancel(this.active,this.cancelReason),'Draft canceled. Containers remain packed and available for another shipment.',()=>this.undoSerial=''); }
}
