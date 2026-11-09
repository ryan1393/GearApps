import { Route } from '@angular/router';
import { adminRoleGuard, authGuard } from '@libs/frontend/data-access-common';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'blades' },
  {
    path: 'blades',
    canActivate: [authGuard],
    loadChildren: () =>
      import('@libs/frontend/feature-blade-tracking').then(
        (m) => m.frontendFeatureBladeTrackingRoutes,
      ),
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminRoleGuard],
    loadChildren: () =>
      import('@libs/frontend/feature-admin-users').then(
        (m) => m.frontendFeatureAdminUsersRoutes,
      ),
  },
  {
    path: 'login',
    loadChildren: () =>
      import('@libs/frontend/feature-login').then(
        (m) => m.frontendFeatureLoginRoutes,
      ),
  },
  { path: 'client', pathMatch: 'full', redirectTo: 'blades' },
  { path: 'forgot-password', loadChildren: () => import('@libs/frontend/feature-login').then(m => m.frontendForgotPasswordRoutes) },
  { path: 'reset-password', loadChildren: () => import('@libs/frontend/feature-login').then(m => m.frontendResetPasswordRoutes) },
  { path: '**', redirectTo: 'blades' },
];
