import { MachineCountsComponent } from '@meshforge/manufacturing/frontend/util-common';
import { Route } from '@angular/router';
import { adminRoleGuard, authGuard } from '@meshforge/manufacturing/frontend/data-access-common';

export const appRoutes: Route[] = [
  { path: 'machine-counts', canActivate: [authGuard], component: MachineCountsComponent },
  { path: '', pathMatch: 'full', redirectTo: 'greenshed' },
  {
    path: 'greenshed',
    canActivate: [authGuard],
    loadChildren: () =>
      import('@meshforge/manufacturing/frontend/feature-greenshed').then(
        (m) => m.frontendFeatureGreenshedRoutes,
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
  { path: '**', redirectTo: 'greenshed' },
];
