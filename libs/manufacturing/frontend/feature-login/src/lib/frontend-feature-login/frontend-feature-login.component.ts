import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, inject, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
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
  signInMethod: 'password' | 'badge' = 'password';
  /** Shown when a badge scan arrives while a sign-in is still running. */
  badgeNotice = '';

  loginForm = new FormGroup<LoginFormType>({
    email: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
      updateOn: 'submit',
    }),
    password: new FormControl<string>('', {
      nonNullable: true,
      // Required only: accounts created under an older, shorter password policy must still sign in.
      validators: [Validators.required],
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
      this.signInMethod = 'password';
      this.cdr.markForCheck();
      this.session
        .login({ ...this.loginForm.getRawValue() })
        .pipe(takeUntilDestroyed(this.destroyRef))
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
      this.focus(this.fEmail.invalid ? '#email' : '#password');
    }
  }

  loginBadge(): void {
    if (this.submitting) {
      this.badgeUid = '';
      this.showBadgeWait();
      return;
    }
    const uid = this.badgeUid;
    this.badgeUid = '';
    this.loginError = '';
    this.badgeNotice = '';
    if (!/^[!-~]{1,128}$/.test(uid)) {
      this.loginError = 'Scan a card UID, then press Enter.';
      this.focus('#badge-uid');
      return;
    }
    this.submitting = true;
    this.signInMethod = 'badge';
    this.cdr.markForCheck();
    this.session.loginBadge(uid).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitting = false;
        this.badgeNotice = '';
        const redirect = this.route.snapshot.queryParamMap.get(REDIRECT_URL_QUERY_PARAM);
        void this.router.navigateByUrl(redirect || '/');
      },
      error: (error: HttpErrorResponse) => {
        this.submitting = false;
        this.badgeNotice = '';
        this.loginError = typeof error.error?.message === 'string' ? error.error.message : 'Badge sign-in failed. Use your email and password.';
        this.cdr.markForCheck();
        this.focus('#badge-uid');
      },
    });
  }

  /**
   * The badge field stays focusable (read-only) while signing in, so a second scan is not typed
   * into another field; tell the operator to wait instead of losing it silently.
   */
  badgeKeydown(event: KeyboardEvent): void {
    if (!this.submitting) return;
    if (event.key === 'Enter') event.preventDefault();
    this.showBadgeWait();
  }

  private showBadgeWait(): void {
    this.badgeNotice = 'Wait — still signing in. Scan again once this sign-in finishes.';
    this.cdr.markForCheck();
  }

  private focus(selector: string): void {
    this.cdr.detectChanges();
    this.element.nativeElement.querySelector<HTMLInputElement>(selector)?.focus();
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
