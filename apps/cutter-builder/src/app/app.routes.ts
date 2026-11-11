import { Route } from '@angular/router';
import { adminRoleGuard, authGuard } from '@meshforge/manufacturing/frontend/data-access-common';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'cutter-builder' },
  {
    path: 'cutter-builder',
    canActivate: [authGuard],
    loadChildren: () =>
      import('@meshforge/manufacturing/frontend/feature-cutter-builder').then(
        (m) => m.frontendFeatureCutterBuilderRoutes,
      ),
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
  { path: 'forgot-password', loadChildren: () => import('@meshforge/manufacturing/frontend/feature-login').then(m => m.frontendForgotPasswordRoutes) },
  { path: 'reset-password', loadChildren: () => import('@meshforge/manufacturing/frontend/feature-login').then(m => m.frontendResetPasswordRoutes) },
  { path: '**', redirectTo: 'cutter-builder' },
];
