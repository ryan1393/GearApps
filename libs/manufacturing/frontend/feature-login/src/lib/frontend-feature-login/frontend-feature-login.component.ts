import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, isDevMode } from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { REDIRECT_URL_QUERY_PARAM } from '@meshforge/manufacturing/frontend/data-access-common';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { PASSWORD_MIN_LENGTH } from '@meshforge/manufacturing/shared/util-constants';
import { IUserLogin } from '@meshforge/manufacturing/shared/util-types';

type LoginFormType = Record<keyof IUserLogin, FormControl<string>>;

@Component({
  selector: 'gear-frontend-feature-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './frontend-feature-login.component.html',
  styleUrls: ['./frontend-feature-login.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrontendFeatureLoginComponent {
  private readonly session = inject(AuthSessionService);
  private readonly cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly authState$ = this.session.authState$;
  // Development builds only: a production build served on a host's own localhost (the Docker
  // host, a kiosk, an SSH port-forward) must not advertise test account names.
  readonly showLocalTestLogin =
    isDevMode() &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname);
  readonly localTestEmail = 'test@meshforge.local';
  readonly localAdminEmail = 'admin@meshforge.local';
  badgeUid = '';
  loginError = '';
  submitting = false;

  loginForm = new FormGroup<LoginFormType>({
    email: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
      updateOn: 'submit',
    }),
    password: new FormControl<string>('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(PASSWORD_MIN_LENGTH),
      ],
      updateOn: 'submit',
    }),
  });

  get fEmail(): FormControl {
    return this.loginForm.get('email') as FormControl;
  }

  get fPassword(): FormControl {
    return this.loginForm.get('password') as FormControl;
  }

  login() {
    if (this.submitting) return;
    this.loginError = '';

    if (this.loginForm.valid) {
      this.submitting = true;
      this.cdr.markForCheck();
      this.session
        .login({ ...this.loginForm.getRawValue() })
        .subscribe({
          next: () => {
            this.submitting = false;
            const redirectUrl = this.route.snapshot.queryParamMap.get(
              REDIRECT_URL_QUERY_PARAM,
            );
            if (redirectUrl) {
              void this.router.navigateByUrl(redirectUrl);
            } else {
              void this.router.navigate(['/']);
            }
          },
          error: (error: HttpErrorResponse) => {
            this.submitting = false;
            const message =
              typeof error.error?.message === 'string'
                ? error.error.message
                : 'Unable to sign in. Check your email and password.';
            this.loginError = message;
            this.cdr.markForCheck();
          },
        });
    } else {
      this.loginForm.markAllAsTouched();
      this.loginError = 'Enter a valid email address and password.';
    }
  }

  loginBadge(): void {
    if (this.submitting) return;
    const uid = this.badgeUid;
    this.badgeUid = '';
    this.loginError = '';
    if (!/^[!-~]{1,128}$/.test(uid)) { this.loginError = 'Scan a card UID, then press Enter.'; return; }
    this.submitting = true;
    this.session.loginBadge(uid).subscribe({
      next: () => {
        this.submitting = false;
        const redirect = this.route.snapshot.queryParamMap.get(REDIRECT_URL_QUERY_PARAM);
        void this.router.navigateByUrl(redirect || '/');
      },
      error: (error: HttpErrorResponse) => {
        this.submitting = false;
        this.loginError = typeof error.error?.message === 'string' ? error.error.message : 'Badge sign-in failed. Use your email and password.';
        this.cdr.markForCheck();
      },
    });
  }

  useLocalAdminLogin(): void {
    if (!this.showLocalTestLogin) return;
    this.loginForm.patchValue({
      email: this.localAdminEmail,
    });
  }

  useLocalTestLogin(): void {
    if (!this.showLocalTestLogin) return;
    this.loginForm.patchValue({
      email: this.localTestEmail,
    });
  }
}
