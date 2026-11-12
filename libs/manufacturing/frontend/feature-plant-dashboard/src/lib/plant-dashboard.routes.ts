import type { Routes } from '@angular/router';
import { authGuard } from '@meshforge/manufacturing/frontend/data-access-common';

export const plantDashboardRoutes: Routes = [
  { path: 'login', loadComponent: () => import('./login.component').then(module => module.LoginComponent) },
  { path: '', canActivate: [authGuard], loadComponent: () => import('./dashboard.component').then(module => module.DashboardComponent) },
  { path: '**', redirectTo: '' },
];
