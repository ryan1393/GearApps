import type { Routes } from '@angular/router';
import { authGuard, signedOutGuard } from '@meshforge/manufacturing/frontend/data-access-common';

export const plantDashboardRoutes: Routes = [
  { path: 'login', canActivate: [signedOutGuard], loadComponent: () => import('./login.component').then(module => module.LoginComponent) },
  { path: 'hourly', canActivate: [authGuard], loadComponent: () => import('./hourly.component').then(module => module.HourlyComponent) },
  { path: 'history', canActivate: [authGuard], loadComponent: () => import('./history.component').then(module => module.HistoryComponent) },
  { path: '', canActivate: [authGuard], loadComponent: () => import('./dashboard.component').then(module => module.DashboardComponent) },
  { path: '**', redirectTo: '' },
];
