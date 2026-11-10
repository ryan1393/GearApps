import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage, AuthService } from '@gearapps/client/core';
import { AuthPageComponent } from './auth-page.component';

@Component({
  selector: 'gear-login',
  imports: [ReactiveFormsModule, RouterLink, AuthPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-auth-page
      title="Sign in to GearApps"
      description="Use your GearApps account to continue."
    >
      @if (error()) {
        <div class="login-error" role="alert">
          <span class="login-error-icon">!</span><span>{{ error() }}</span>
        </div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="login-form">
        <label class="field-label" for="email">Email</label>
        <input
          id="email"
          formControlName="email"
          type="email"
          autocomplete="username"
          required
          class="field-input"
          [class.field-error]="showError('email')"
          placeholder="Your GearApps email"
        />
        @if (showError('email')) {
          <small class="field-message">Enter your email.</small>
        }

        <div class="password-label-row">
          <label class="field-label" for="password">Password</label>
          <span class="password-help">Account login</span>
        </div>
        <input
          id="password"
          formControlName="password"
          type="password"
          autocomplete="current-password"
          required
          class="field-input"
          [class.field-error]="showError('password')"
          placeholder="Enter your password"
        />
        @if (showError('password')) {
          <small class="field-message">Password is required.</small>
        }

        <button type="submit" class="login-submit" [disabled]="busy()" [attr.aria-busy]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <div class="login-footer">
        <span class="login-footer-dot"></span>
        @if (registrationEnabled()) {
          <a routerLink="/register">No account? Create one</a>
        } @else {
          <span>Use your existing GearApps account</span>
        }
      </div>
    </gear-auth-page>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly registrationEnabled = signal(false);
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    this.auth.capabilities().subscribe({
      next: (capabilities) => this.registrationEnabled.set(capabilities.registrationEnabled),
      error: () => this.registrationEnabled.set(false),
    });
  }

  protected showError(name: 'email' | 'password') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty) && !this.busy();
  }

  protected submit() {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(this.form.getRawValue()).subscribe({
      next: () =>
        this.router.navigateByUrl(
          this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard',
        ),
      error: (err) => {
        this.form.controls.password.setValue('');
        this.error.set(apiErrorMessage(err, 'Unable to sign in. Check your login and password.'));
        this.busy.set(false);
      },
    });
  }
}
