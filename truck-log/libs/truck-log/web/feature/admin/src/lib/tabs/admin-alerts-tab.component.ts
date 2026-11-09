import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { DockAgingSettingsRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';
import { AdminDataStore } from '../admin-data.store';

/** Administration > Dock Alerts (dock aging thresholds). */
@Component({
  selector: 'section[tlAdminAlertsTab]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dana-panel-header">
      <div><h2>Dock time alerts</h2><small>When a truck at a dock turns yellow, then red</small></div>
    </div>
    <div class="dana-panel-body tl-stack">
      <p class="dana-page-description">Only trucks still assigned to a dock are colored. Yellow starts at the first threshold; red starts at the second.</p>
      <form class="dana-filter-row" (ngSubmit)="saveDockAging()">
        <label>Yellow after (minutes)<input name="warningMinutes" type="number" min="1" max="10080" step="1" [(ngModel)]="warningMinutes"></label>
        <label>Red after (minutes)<input name="criticalMinutes" type="number" min="2" max="10080" step="1" [(ngModel)]="criticalMinutes"></label>
        <div class="dana-actions tl-filter-actions"><button class="dana-btn dana-btn-primary" type="submit" [disabled]="data.busy || !dockAgingValid">Save alerts</button></div>
      </form>
      <p class="dana-note" *ngIf="dockAgingValid">Yellow at {{warningMinutes}} minutes; red at {{criticalMinutes}} minutes.</p>
      <p class="dana-alert dana-alert-danger" *ngIf="!dockAgingValid">Red minutes must be greater than yellow minutes.</p>
    </div>`,
})
export class AdminAlertsTabComponent implements OnInit {
  warningMinutes = 15;
  criticalMinutes = 30;

  constructor(readonly data: AdminDataStore, private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  ngOnInit() {
    this.api.dockAgingSettings().subscribe({
      next: (settings) => {
        this.warningMinutes = settings.warningMinutes;
        this.criticalMinutes = settings.criticalMinutes;
      },
      error: () => this.toast.error('Could not load dock time alert settings.', 'Settings load failed'),
    });
  }

  get dockAgingValid() {
    return Number.isInteger(Number(this.warningMinutes))
      && Number.isInteger(Number(this.criticalMinutes))
      && Number(this.warningMinutes) >= 1
      && Number(this.criticalMinutes) > Number(this.warningMinutes);
  }

  saveDockAging() {
    if (this.data.busy || !this.dockAgingValid) return;
    const payload: DockAgingSettingsRecord = {
      warningMinutes: Number(this.warningMinutes),
      criticalMinutes: Number(this.criticalMinutes),
    };
    this.data.busy = true;
    this.api.updateDockAgingSettings(payload).subscribe({
      next: (settings) => {
        this.data.busy = false;
        this.warningMinutes = settings.warningMinutes;
        this.criticalMinutes = settings.criticalMinutes;
        this.toast.success(`Yellow at ${settings.warningMinutes} min, red at ${settings.criticalMinutes} min.`, 'Dock alerts saved');
      },
      error: (e) => {
        this.data.busy = false;
        this.toast.error(e?.error?.message || 'Could not save dock time alert settings.', 'Could not save dock alerts');
      },
    });
  }
}
