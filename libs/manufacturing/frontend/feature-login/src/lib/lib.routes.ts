import { Route } from '@angular/router';
import { PasswordRecoveryComponent } from './password-recovery/password-recovery.component';
import { FrontendFeatureLoginComponent } from './frontend-feature-login/frontend-feature-login.component';

export const frontendFeatureLoginRoutes: Route[] = [
  { path: '', component: FrontendFeatureLoginComponent },
];

export const frontendForgotPasswordRoutes: Route[] = [
  { path: '', component: PasswordRecoveryComponent, data: { mode: 'forgot' } },
];
export const frontendResetPasswordRoutes: Route[] = [
  { path: '', component: PasswordRecoveryComponent, data: { mode: 'reset' } },
];
