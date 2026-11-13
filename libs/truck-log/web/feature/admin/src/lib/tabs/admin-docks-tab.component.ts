import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { DockRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';
import { AdminDataStore } from '../admin-data.store';

/** Administration > Docks (hosted on the tab-panel <section>). */
@Component({
  selector: 'section[tlAdminDocksTab]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dana-panel-header">
      <div><h2>Docks</h2><small>{{data.activeDockCount}} active / {{data.docks.length - data.activeDockCount}} disabled</small></div>
    </div>
    <div class="dana-panel-body tl-stack">
      <p class="dana-page-description">Add the dock codes used at check-in. Disable a dock instead of deleting it so past assignments stay intact.</p>
      <form class="dana-filter-row" (ngSubmit)="addDock()">
        <label>Dock code<input name="dockCode" [(ngModel)]="newCode" placeholder="Example: 25"></label>
        <label class="tl-admin-grow"><span class="dana-field-head"><span>Description</span><span class="dana-field-tag">Optional</span></span><input name="dockDescription" [(ngModel)]="newDescription" placeholder="Example: Receiving"></label>
        <div class="dana-actions tl-filter-actions"><button class="dana-btn dana-btn-primary" type="submit" [disabled]="!newCode.trim() || data.busy">Add dock</button></div>
      </form>
    </div>
    <!-- The dock list (often 25+) is the part that scrolls; the add form stays in view. -->
    <ul class="dana-action-list tl-scroll" *ngIf="data.docks.length">
      <li class="dana-action-row" *ngFor="let d of data.docks">
        <div class="dana-action-main"><strong>{{d.code}}</strong><span>{{d.description || 'No description'}}</span></div>
        <span class="dana-status-badge" [attr.data-tone]="d.active ? 'success' : 'neutral'">{{d.active ? 'Active' : 'Disabled'}}</span>
        <button class="dana-btn" type="button" [disabled]="data.busy" (click)="toggle(d)">{{d.active ? 'Disable' : 'Enable'}}</button>
      </li>
    </ul>
    <div class="dana-empty-state" *ngIf="!data.docks.length" role="status">{{data.state.docks === 'ready' ? 'No docks configured yet.' : data.emptyText('docks', 'docks', '')}}</div>`,
})
export class AdminDocksTabComponent {
  newCode = '';
  newDescription = '';

  constructor(readonly data: AdminDataStore, private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  addDock() {
    const code = this.newCode.trim().toUpperCase();
    if (!code || this.data.busy) return;
    this.data.busy = true;
    this.api.createDock({ code, description: this.newDescription.trim() }).subscribe({
      next: () => { this.data.busy = false; this.toast.success(`Dock ${code} added.`, 'Dock added'); this.newCode = ''; this.newDescription = ''; this.data.loadDocks(); },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not add dock.', 'Could not add dock'); },
    });
  }

  toggle(d: DockRecord) {
    if (this.data.busy) return;
    this.data.busy = true;
    this.api.setDockActive(d.id, !d.active).subscribe({
      next: (saved) => { this.data.busy = false; this.data.replaceDock(saved); this.toast.success(`Dock ${d.code} ${d.active ? 'disabled' : 'enabled'}.`, 'Dock updated'); },
      error: (e) => { this.data.busy = false; this.toast.error(e?.error?.message || 'Could not update dock.', 'Could not update dock'); },
    });
  }
}
