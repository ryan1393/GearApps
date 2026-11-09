import { Route } from '@angular/router';
import { adminRoleGuard, authGuard } from '@gearapps/manufacturing/frontend/data-access-common';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'cutter-builder' },
  {
    path: 'cutter-builder',
    canActivate: [authGuard],
    loadChildren: () =>
      import('@gearapps/manufacturing/frontend/feature-cutter-builder').then(
        (m) => m.frontendFeatureCutterBuilderRoutes,
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
  { path: 'forgot-password', loadChildren: () => import('@gearapps/manufacturing/frontend/feature-login').then(m => m.frontendForgotPasswordRoutes) },
  { path: 'reset-password', loadChildren: () => import('@gearapps/manufacturing/frontend/feature-login').then(m => m.frontendResetPasswordRoutes) },
  { path: '**', redirectTo: 'cutter-builder' },
];
