import { Route } from '@angular/router';
import { signedOutGuard } from '@meshforge/manufacturing/frontend/data-access-common';
import { PasswordRecoveryComponent } from './password-recovery/password-recovery.component';
import { FrontendFeatureLoginComponent } from './frontend-feature-login/frontend-feature-login.component';

export const frontendFeatureLoginRoutes: Route[] = [
  // A signed-in user who opens the sign-in page goes on to the app instead.
  { path: '', canActivate: [signedOutGuard], component: FrontendFeatureLoginComponent },
];

export const frontendForgotPasswordRoutes: Route[] = [
  { path: '', component: PasswordRecoveryComponent, data: { mode: 'forgot' } },
];
export const frontendResetPasswordRoutes: Route[] = [
  { path: '', component: PasswordRecoveryComponent, data: { mode: 'reset' } },
];
