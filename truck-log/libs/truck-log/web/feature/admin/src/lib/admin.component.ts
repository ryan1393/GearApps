import { TruckLogAdminAccessComponent } from '@truck-log/web/auth/admin';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminDataStore } from './admin-data.store';
import { GatePrintingComponent } from './gate-printing.component';
import { PackingSlipWatcherComponent } from './packing-slip-watcher.component';
import { AdminAlertsTabComponent } from './tabs/admin-alerts-tab.component';
import { AdminCarriersTabComponent } from './tabs/admin-carriers-tab.component';
import { AdminDocksTabComponent } from './tabs/admin-docks-tab.component';
import { AdminDriversTabComponent } from './tabs/admin-drivers-tab.component';
import { AdminLocationsTabComponent } from './tabs/admin-locations-tab.component';
import { AdminScheduleTabComponent } from './tabs/admin-schedule-tab.component';
import { AdminWorkflowTabComponent } from './tabs/admin-workflow-tab.component';

/** Administration: tab bar plus one component per tab; shared lists live in AdminDataStore. */
@Component({
  standalone: true,
  imports: [
    CommonModule, GatePrintingComponent, PackingSlipWatcherComponent, TruckLogAdminAccessComponent,
    AdminDriversTabComponent, AdminCarriersTabComponent, AdminLocationsTabComponent,
    AdminDocksTabComponent, AdminAlertsTabComponent, AdminScheduleTabComponent, AdminWorkflowTabComponent,
  ],
  providers: [AdminDataStore],
  template: `
  <tl-admin-access></tl-admin-access>
  <div class="tl-admin">
  <header class="dana-page-header">
    <div>
      <h1>Administration</h1>
      <p>Manage Truck Log reference data and operational settings.</p>
    </div>
  </header>

  <nav class="dana-tabs" role="tablist" aria-label="Administration sections">
    <button type="button" class="dana-tab" role="tab"
      [class.is-active]="activeAdminTab === 'drivers'" [attr.aria-selected]="activeAdminTab === 'drivers'"
      (click)="activeAdminTab = 'drivers'">Drivers <span class="dana-count-badge">{{data.drivers.length}}</span></button>
    <button type="button" class="dana-tab" role="tab"
      [class.is-active]="activeAdminTab === 'carriers'" [attr.aria-selected]="activeAdminTab === 'carriers'"
      (click)="activeAdminTab = 'carriers'">Carriers <span class="dana-count-badge">{{data.carriers.length}}</span></button>
    <button type="button" class="dana-tab" role="tab"
      [class.is-active]="activeAdminTab === 'locations'" [attr.aria-selected]="activeAdminTab === 'locations'"
      (click)="activeAdminTab = 'locations'">Locations <span class="dana-count-badge">{{data.locations.length}}</span></button>
    <button type="button" class="dana-tab" role="tab"
      [class.is-active]="activeAdminTab === 'docks'" [attr.aria-selected]="activeAdminTab === 'docks'"
      (click)="activeAdminTab = 'docks'">Docks <span class="dana-count-badge">{{data.activeDockCount + '/' + data.docks.length}}</span></button>
    <button type="button" class="dana-tab" role="tab"
      [class.is-active]="activeAdminTab === 'alerts'" [attr.aria-selected]="activeAdminTab === 'alerts'"
      (click)="activeAdminTab = 'alerts'">Dock alerts</button>
    <button type="button" class="dana-tab" role="tab"
      [class.is-active]="activeAdminTab === 'schedule'" [attr.aria-selected]="activeAdminTab === 'schedule'"
      (click)="activeAdminTab = 'schedule'">Scheduled loads <span class="dana-count-badge">{{data.scheduledLoads.length}}</span></button>
    <button type="button" class="dana-tab" role="tab"
      [class.is-active]="activeAdminTab === 'workflow'" [attr.aria-selected]="activeAdminTab === 'workflow'"
      (click)="activeAdminTab = 'workflow'">Workflow</button>
    <button type="button" class="dana-tab" role="tab" id="truck-log-printing-tab" aria-controls="truck-log-printing-panel"
      [class.is-active]="activeAdminTab === 'printing'" [attr.aria-selected]="activeAdminTab === 'printing'"
      (click)="activeAdminTab = 'printing'">Printing</button>
  </nav>

  <div id="truck-log-printing-panel" class="tl-fill" role="tabpanel" aria-labelledby="truck-log-printing-tab" [hidden]="activeAdminTab !== \'printing\'">
    <div class="tl-stack tl-scroll">
      <tl-gate-printing></tl-gate-printing>
      <tl-packing-slip-watcher></tl-packing-slip-watcher>
    </div>
  </div>

  <div tlAdminDriversTab class="tl-fill" [hidden]="activeAdminTab !== \'drivers\'" role="tabpanel"></div>
  <div tlAdminCarriersTab class="tl-fill" [hidden]="activeAdminTab !== \'carriers\'" role="tabpanel"></div>
  <div tlAdminLocationsTab class="tl-fill" [hidden]="activeAdminTab !== \'locations\'" role="tabpanel"></div>
  <section tlAdminDocksTab class="dana-panel tl-fill" [hidden]="activeAdminTab !== \'docks\'" role="tabpanel"></section>
  <section tlAdminAlertsTab class="dana-panel tl-fill" [hidden]="activeAdminTab !== \'alerts\'" role="tabpanel"></section>
  <section tlAdminScheduleTab class="dana-panel tl-fill" [hidden]="activeAdminTab !== \'schedule\'" role="tabpanel"></section>
  <section tlAdminWorkflowTab class="dana-panel tl-fill" [hidden]="activeAdminTab !== \'workflow\'" role="tabpanel"></section>
  </div>`
})
// Tabs stay mounted ([hidden], not *ngIf) so unsaved row edits survive switching tabs.
export class AdminComponent implements OnInit {
  activeAdminTab = 'drivers';

  constructor(readonly data: AdminDataStore) {}

  ngOnInit() { this.data.load(); }
}
