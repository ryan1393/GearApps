import { Route } from '@angular/router';
import { adminRoleGuard, authGuard } from '@libs/frontend/data-access-common';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'greenshed' },
  {
    path: 'greenshed',
    canActivate: [authGuard],
    loadChildren: () =>
      import('@libs/frontend/feature-greenshed').then(
        (m) => m.frontendFeatureGreenshedRoutes,
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
  { path: 'forgot-password', loadChildren: () => import('@libs/frontend/feature-login').then(m => m.frontendForgotPasswordRoutes) },
  { path: 'reset-password', loadChildren: () => import('@libs/frontend/feature-login').then(m => m.frontendResetPasswordRoutes) },
  { path: '**', redirectTo: 'greenshed' },
];
