import { Routes } from '@angular/router';
import {
  truckLogAdminGuard,
  TruckLogAdminLoginComponent,
  TruckLogAdminPasswordComponent,
  TruckLogAdminUsersComponent,
} from '@truck-log/web/auth/admin';
import { StationSetupComponent, StationsAdminComponent, truckLogRoleGuard } from '@truck-log/web/auth/station';
import { ActiveTrucksComponent } from '@truck-log/web/feature/active-trucks';
import { AdminComponent } from '@truck-log/web/feature/admin';
import { CheckInComponent } from '@truck-log/web/feature/check-in';
import { DashboardComponent } from '@truck-log/web/feature/dashboard';
import { DockBoardComponent } from '@truck-log/web/feature/dock-board';
import { HistoryComponent } from '@truck-log/web/feature/history';
import { RxoControlCenterComponent } from '@truck-log/web/feature/rxo-control-center';
import { RxoExpediteControlCenterComponent } from '@truck-log/web/feature/rxo-expedite-control-center';
import { TvDisplayComponent } from '@truck-log/web/feature/tv-display';

/**
 * `data.screen` + truckLogRoleGuard: each role opens only its screens (see web/auth/station station-roles.ts);
 * the server enforces the same limits on the API.
 */
export const routes: Routes = [
  { path: '', component: DashboardComponent, canActivate: [truckLogRoleGuard], data: { screen: 'dashboard' }, title: 'Guard Dashboard | Truck Log' },
  { path: 'check-in', component: CheckInComponent, canActivate: [truckLogRoleGuard], data: { screen: 'check-in' }, title: 'Check In Truck | Truck Log' },
  { path: 'dock-board', component: DockBoardComponent, canActivate: [truckLogRoleGuard], data: { screen: 'dock-board' }, title: 'Dock Board | Truck Log' },
  { path: 'active-trucks', component: ActiveTrucksComponent, canActivate: [truckLogRoleGuard], data: { screen: 'active-trucks' }, title: 'Active Trucks | Truck Log' },
  { path: 'history', component: HistoryComponent, canActivate: [truckLogRoleGuard], data: { screen: 'history' }, title: 'Records & Paperwork | Truck Log' },
  { path: 'rxo', component: RxoControlCenterComponent, canActivate: [truckLogRoleGuard], data: { screen: 'rxo' }, title: 'RXO Control Center | Truck Log' },
  { path: 'rxo-expedite', component: RxoExpediteControlCenterComponent, canActivate: [truckLogRoleGuard], data: { screen: 'rxo-expedite' }, title: 'RXO Expedite Control Center | Truck Log' },
  { path: 'admin/login', component: TruckLogAdminLoginComponent, title: 'Admin Sign In | Truck Log' },
  { path: 'admin/password', component: TruckLogAdminPasswordComponent, canActivate: [truckLogRoleGuard, truckLogAdminGuard], data: { screen: 'admin' }, title: 'Change Password | Truck Log' },
  { path: 'station/setup', component: StationSetupComponent, title: 'Set Up Station | Truck Log' },
  { path: 'admin/stations', component: StationsAdminComponent, canActivate: [truckLogRoleGuard, truckLogAdminGuard], data: { screen: 'admin' }, title: 'Stations | Truck Log' },
  { path: 'admin/users', component: TruckLogAdminUsersComponent, canActivate: [truckLogRoleGuard, truckLogAdminGuard], data: { screen: 'admin' }, title: 'Users | Truck Log' },
  { path: 'admin', component: AdminComponent, canActivate: [truckLogRoleGuard, truckLogAdminGuard], data: { screen: 'admin' }, title: 'Settings | Truck Log' },
  { path: 'tv/docks', component: TvDisplayComponent, canActivate: [truckLogRoleGuard], title: 'Dockworker TV | Truck Log', data: { tvAudience: 'docks', screen: 'tv' } },
  { path: 'tv/management', component: TvDisplayComponent, canActivate: [truckLogRoleGuard], title: 'Management TV | Truck Log', data: { tvAudience: 'management', screen: 'tv' } },
  { path: '**', redirectTo: '' },
];
