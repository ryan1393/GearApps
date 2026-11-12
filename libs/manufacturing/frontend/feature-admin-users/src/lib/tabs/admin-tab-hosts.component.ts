import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { loadable } from '@meshforge/client/core';

import { AccessManagementComponent } from '../access-management.component';
import { AdminApiService, AdminUser, MachineRow } from '../admin-api.service';
import { LappingMachinesComponent } from '../lapping/lapping-machines.component';
import { LaunchSetupComponent } from '../launch-setup/launch-setup.component';
import { allPages } from '../shared/admin-data';
import { AdminListStateComponent } from '../shared/admin-list-state.component';
import { isAdminTab } from '../shared/admin-tabs';

// Route hosts for tabs that are separate components needing data or navigation from the Admin page.

/** Admin > Roles & Badges, given the user list it assigns roles and badges to. */
@Component({
  selector: 'gear-admin-access-tab',
  standalone: true,
  imports: [AccessManagementComponent, AdminListStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
  template: `
    @if (users.error() !== null) {
      <gear-admin-list-state [list]="users" noun="users" (retry)="load()" />
    }
    <gear-access-management [users]="users.value()" />
  `,
})
export class AdminAccessTabComponent implements OnInit, OnDestroy {
  private readonly api = inject(AdminApiService);
  readonly users = loadable<AdminUser[]>([]);
  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.users.dispose(); }
  load(): void { this.users.load(allPages((page) => this.api.listUsers(page, 50))); }
}

/** Admin > Lapping Machines, given the shared machine list it links lapping setups to. */
@Component({
  selector: 'gear-admin-lapping-machines-tab',
  standalone: true,
  imports: [LappingMachinesComponent, AdminListStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dana-page-stack' },
  template: `
    @if (machines.error() !== null) {
      <gear-admin-list-state [list]="machines" noun="machines" (retry)="load()" />
    }
    <gear-admin-lapping-machines [sharedMachines]="machines.value()" />
  `,
})
export class AdminLappingMachinesTabComponent implements OnInit, OnDestroy {
  private readonly api = inject(AdminApiService);
  readonly machines = loadable<MachineRow[]>([]);
  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.machines.dispose(); }
  load(): void { this.machines.load(this.api.listMachines()); }
}

/** Admin > Launch Setup, whose checklist opens other Admin tabs. */
@Component({
  selector: 'gear-admin-launch-tab',
  standalone: true,
  imports: [LaunchSetupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<gear-admin-launch-setup (openTab)="open($event)" />`,
})
export class AdminLaunchTabComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  open(tab: string): void {
    if (isAdminTab(tab)) void this.router.navigate(['..', tab], { relativeTo: this.route });
  }
}
