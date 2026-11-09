import { Routes } from '@angular/router';
import { guestGuard } from '@gearapps/client/core';

export const authRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login.component').then((m) => m.LoginComponent),
    title: 'Sign in · GearApps',
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./register.component').then((m) => m.RegisterComponent),
    title: 'Create account · GearApps',
  },
];
