import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';
import { AdminDataStore } from '../admin-data.store';

/** Administration > Scheduled Loads (Excel template download and import). */
@Component({
  selector: 'section[tlAdminScheduleTab]',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dana-panel-header">
      <div><h2>Scheduled loads</h2><small>{{data.scheduledLoads.length}} active scheduled load{{data.scheduledLoads.length === 1 ? '' : 's'}}</small></div>
      <a class="dana-btn" [href]="api.scheduledLoadsTemplateUrl()">Download Excel template</a>
    </div>
    <div class="dana-panel-body tl-stack">
      <p class="dana-page-description">Fill in Load Number, Scheduled Date and Scheduled Time in the template, then upload it. Existing load numbers are updated; new ones are added.</p>
      <label class="dana-dropzone">
        <input #scheduleFileInput type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="chooseScheduleFile($event)">
        <strong>{{scheduleFile ? scheduleFile.name : 'Choose the Excel file'}}</strong>
        <span>{{scheduleFile ? 'Ready to upload' : '.xlsx made from the template'}}</span>
      </label>
      <div class="dana-actions"><button class="dana-btn dana-btn-primary" type="button" [disabled]="data.busy || !scheduleFile" (click)="uploadSchedule()">Upload schedule</button></div>
    </div>
    <div class="dana-table-shell" *ngIf="data.scheduledLoads.length">
      <table class="dana-table"><thead><tr><th scope="col">Load number</th><th scope="col">Scheduled</th><th scope="col">Source</th></tr></thead><tbody>
        <tr *ngFor="let load of data.scheduledLoads"><td><b>{{load.loadNumber}}</b></td><td>{{load.scheduledAt | date:'M/d/yy h:mm a'}}</td><td>{{load.source || 'Manual/System'}}</td></tr>
      </tbody></table>
    </div>
    <div class="dana-empty-state" *ngIf="!data.scheduledLoads.length" role="status">{{data.state.scheduledLoads === 'ready' ? 'No active scheduled loads have been imported yet.' : data.emptyText('scheduledLoads', 'scheduled loads', '')}}</div>`,
})
export class AdminScheduleTabComponent {
  scheduleFile: File | null = null;
  @ViewChild('scheduleFileInput') scheduleFileInput?: ElementRef<HTMLInputElement>;

  constructor(readonly data: AdminDataStore, readonly api: TruckLogApi, private readonly toast: ToastService) {}

  chooseScheduleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    this.scheduleFile = input.files?.[0] ?? null;
  }

  uploadSchedule() {
    if (!this.scheduleFile || this.data.busy) return;
    const file = this.scheduleFile;
    this.data.busy = true;
    this.api.importScheduledLoads(file).subscribe({
      next: (result) => {
        this.data.busy = false;
        this.scheduleFile = null;
        if (this.scheduleFileInput) this.scheduleFileInput.nativeElement.value = '';
        this.toast.success(`Schedule imported: ${result.rows} rows (${result.inserted} new, ${result.updated} updated).`, 'Schedule import complete');
        this.data.loadScheduledLoads();
      },
      error: (e) => {
        this.data.busy = false;
        this.toast.error(typeof e?.error?.message === 'string' ? e.error.message : 'Could not import the schedule workbook.', 'Schedule import failed');
      },
    });
  }
}
