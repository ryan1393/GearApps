import { inject } from '@angular/core';
import { Route, Router } from '@angular/router';
import { adminRoleGuard, authGuard } from '@meshforge/manufacturing/frontend/data-access-common';

/** Redirect an old Lapper page to its tab in the shared Admin screen. */
const adminTab = (tab: string) => () =>
  inject(Router).createUrlTree(['/admin'], { queryParams: { tab } });

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('@meshforge/client/feature-dashboard').then((m) => m.dashboardRoutes),
      },
      {
        path: 'lapping-summaries',
        loadChildren: () =>
          import('@meshforge/client/feature-lapping-summary').then((m) => m.lappingSummaryRoutes),
      },
      {
        path: 'scanners',
        loadChildren: () => import('@meshforge/client/feature-config').then((m) => m.scannersRoutes),
      },
      {
        path: 'macros',
        loadChildren: () => import('@meshforge/client/feature-config').then((m) => m.macrosRoutes),
      },
      {
        path: 'fanuc-variables',
        loadChildren: () =>
          import('@meshforge/client/feature-config').then((m) => m.fanucVariablesRoutes),
      },
      // Bookmarks from the original Lapper app
      { path: 'cell-dashboard', redirectTo: 'dashboard' },
      // Machines, parts, gearsets and summaries are shared master data edited in Admin.
      { path: 'machines', redirectTo: adminTab('lapping-machines') },
      { path: 'machine', redirectTo: adminTab('lapping-machines') },
      { path: 'parts', redirectTo: adminTab('parts') },
      { path: 'part', redirectTo: adminTab('parts') },
      { path: 'gearsets', redirectTo: adminTab('gearsets') },
      { path: 'part-summaries', redirectTo: adminTab('part-summaries') },
      { path: 'part-summary', redirectTo: adminTab('part-summaries') },
      { path: 'register', redirectTo: 'login' },
    ],
  },
  {
    path: 'collector-tokens',
    canActivate: [authGuard, adminRoleGuard],
    loadChildren: () =>
      import('@meshforge/client/feature-config').then((m) => m.collectorTokensRoutes),
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminRoleGuard],
    loadChildren: () =>
      import('@meshforge/manufacturing/frontend/feature-admin-users').then(
        (m) => m.frontendFeatureAdminUsersRoutes,
      ),
  },
  {
    path: 'login',
    loadChildren: () =>
      import('@meshforge/manufacturing/frontend/feature-login').then(
        (m) => m.frontendFeatureLoginRoutes,
      ),
  },
  {
    path: 'forgot-password',
    loadChildren: () =>
      import('@meshforge/manufacturing/frontend/feature-login').then(
        (m) => m.frontendForgotPasswordRoutes,
      ),
  },
  {
    path: 'reset-password',
    loadChildren: () =>
      import('@meshforge/manufacturing/frontend/feature-login').then(
        (m) => m.frontendResetPasswordRoutes,
      ),
  },
  { path: '**', redirectTo: 'dashboard' },
];
