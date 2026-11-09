import { Routes } from '@angular/router';
import { authGuard } from '@gearapps/client/core';
import { authRoutes } from '@gearapps/client/feature-auth';
import { ShellComponent } from '@gearapps/client/shell';

export const appRoutes: Routes = [
  ...authRoutes,
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('@gearapps/client/feature-dashboard').then((m) => m.dashboardRoutes),
      },
      {
        path: 'lapping-summaries',
        loadChildren: () =>
          import('@gearapps/client/feature-lapping-summary').then((m) => m.lappingSummaryRoutes),
      },
      {
        path: 'machines',
        loadChildren: () =>
          import('@gearapps/client/feature-machines').then((m) => m.machinesRoutes),
      },
      {
        path: 'parts',
        loadChildren: () => import('@gearapps/client/feature-parts').then((m) => m.partsRoutes),
      },
      {
        path: 'part-summaries',
        loadChildren: () => import('@gearapps/client/feature-parts').then((m) => m.summariesRoutes),
      },
      // Legacy paths from the previous app
      { path: 'cell-dashboard', redirectTo: 'dashboard' },
      { path: 'machine', redirectTo: 'machines' },
      { path: 'part', redirectTo: 'parts' },
      { path: 'part-summary', redirectTo: 'part-summaries' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
