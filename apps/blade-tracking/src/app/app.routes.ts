import { Route } from '@angular/router';
import { adminRoleGuard, authGuard } from '@gearapps/manufacturing/frontend/data-access-common';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'blades' },
  {
    path: 'blades',
    canActivate: [authGuard],
    loadChildren: () =>
      import('@gearapps/manufacturing/frontend/feature-blade-tracking').then(
        (m) => m.frontendFeatureBladeTrackingRoutes,
      ),
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
  { path: 'client', pathMatch: 'full', redirectTo: 'blades' },
  { path: 'forgot-password', loadChildren: () => import('@gearapps/manufacturing/frontend/feature-login').then(m => m.frontendForgotPasswordRoutes) },
  { path: 'reset-password', loadChildren: () => import('@gearapps/manufacturing/frontend/feature-login').then(m => m.frontendResetPasswordRoutes) },
  { path: '**', redirectTo: 'blades' },
];
