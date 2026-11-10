import { Route } from '@angular/router';
import { adminRoleGuard, authGuard } from '@gearapps/manufacturing/frontend/data-access-common';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
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
      {
        path: 'scanners',
        loadChildren: () => import('@gearapps/client/feature-config').then((m) => m.scannersRoutes),
      },
      {
        path: 'macros',
        loadChildren: () => import('@gearapps/client/feature-config').then((m) => m.macrosRoutes),
      },
      {
        path: 'fanuc-variables',
        loadChildren: () =>
          import('@gearapps/client/feature-config').then((m) => m.fanucVariablesRoutes),
      },
      // Bookmarks from the original Lapper app
      { path: 'cell-dashboard', redirectTo: 'dashboard' },
      { path: 'machine', redirectTo: 'machines' },
      { path: 'part', redirectTo: 'parts' },
      { path: 'part-summary', redirectTo: 'part-summaries' },
      { path: 'register', redirectTo: 'login' },
    ],
  },
  {
    path: 'collector-tokens',
    canActivate: [authGuard, adminRoleGuard],
    loadChildren: () =>
      import('@gearapps/client/feature-config').then((m) => m.collectorTokensRoutes),
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminRoleGuard],
    loadChildren: () =>
      import('@gearapps/manufacturing/frontend/feature-admin-users').then(
        (m) => m.frontendFeatureAdminUsersRoutes,
      ),
  },
  {
    path: 'login',
    loadChildren: () =>
      import('@gearapps/manufacturing/frontend/feature-login').then(
        (m) => m.frontendFeatureLoginRoutes,
      ),
  },
  {
    path: 'forgot-password',
    loadChildren: () =>
      import('@gearapps/manufacturing/frontend/feature-login').then(
        (m) => m.frontendForgotPasswordRoutes,
      ),
  },
  {
    path: 'reset-password',
    loadChildren: () =>
      import('@gearapps/manufacturing/frontend/feature-login').then(
        (m) => m.frontendResetPasswordRoutes,
      ),
  },
  { path: '**', redirectTo: 'dashboard' },
];
