import { Routes } from '@angular/router';
import {
  truckLogAdminGuard,
  TruckLogAdminLoginComponent,
  TruckLogAdminPasswordComponent,
  TruckLogAdminUsersComponent,
} from '@truck-log/web/auth/admin';
import { StationSetupComponent, StationsAdminComponent } from '@truck-log/web/auth/station';
import { ActiveTrucksComponent } from '@truck-log/web/feature/active-trucks';
import { AdminComponent } from '@truck-log/web/feature/admin';
import { CheckInComponent } from '@truck-log/web/feature/check-in';
import { DashboardComponent } from '@truck-log/web/feature/dashboard';
import { DockBoardComponent } from '@truck-log/web/feature/dock-board';
import { HistoryComponent } from '@truck-log/web/feature/history';
import { RxoControlCenterComponent } from '@truck-log/web/feature/rxo-control-center';
import { RxoExpediteControlCenterComponent } from '@truck-log/web/feature/rxo-expedite-control-center';
import { TvDisplayComponent } from '@truck-log/web/feature/tv-display';

export const routes: Routes = [
  { path: '', component: DashboardComponent, title: 'Guard Dashboard | Truck Log' },
  { path: 'check-in', component: CheckInComponent, title: 'Check In Truck | Truck Log' },
  { path: 'dock-board', component: DockBoardComponent, title: 'Dock Board | Truck Log' },
  { path: 'active-trucks', component: ActiveTrucksComponent, title: 'Active Trucks | Truck Log' },
  { path: 'history', component: HistoryComponent, title: 'Records & Paperwork | Truck Log' },
  { path: 'rxo', component: RxoControlCenterComponent, title: 'RXO Control Center | Truck Log' },
  { path: 'rxo-expedite', component: RxoExpediteControlCenterComponent, title: 'RXO Expedite Control Center | Truck Log' },
  { path: 'admin/login', component: TruckLogAdminLoginComponent, title: 'Admin Sign In | Truck Log' },
  { path: 'admin/password', component: TruckLogAdminPasswordComponent, canActivate: [truckLogAdminGuard], title: 'Change Password | Truck Log' },
  { path: 'station/setup', component: StationSetupComponent, title: 'Set Up Station | Truck Log' },
  { path: 'admin/stations', component: StationsAdminComponent, canActivate: [truckLogAdminGuard], title: 'Stations | Truck Log' },
  { path: 'admin/users', component: TruckLogAdminUsersComponent, canActivate: [truckLogAdminGuard], title: 'Users | Truck Log' },
  { path: 'admin', component: AdminComponent, canActivate: [truckLogAdminGuard], title: 'Settings | Truck Log' },
  { path: 'tv/docks', component: TvDisplayComponent, title: 'Dockworker TV | Truck Log', data: { tvAudience: 'docks' } },
  { path: 'tv/management', component: TvDisplayComponent, title: 'Management TV | Truck Log', data: { tvAudience: 'management' } },
  { path: '**', redirectTo: '' },
];
