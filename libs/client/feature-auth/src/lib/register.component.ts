import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage, AuthService, UsersApi } from '@gearapps/client/core';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@gearapps/shared/domain';
import { switchMap } from 'rxjs';
import { AuthPageComponent } from './auth-page.component';

const passwordsMatch = (g: AbstractControl): ValidationErrors | null => {
  const p = g.get('password')?.value;
  const c = g.get('confirm')?.value;
  return p && c && p !== c ? { passwordsMatch: true } : null;
};

@Component({
  selector: 'gear-register',
  imports: [ReactiveFormsModule, RouterLink, AuthPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gear-auth-page
      kicker="GET STARTED"
      title="Create your account"
      description="Accounts are tied to a plant email address."
    >
      @if (error()) {
        <div class="login-error" role="alert">
          <span class="login-error-icon">!</span><span>{{ error() }}</span>
        </div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="login-form">
        <div class="gear-two">
          <div>
            <label class="field-label" for="fname">First name</label>
            <input
              id="fname"
              formControlName="fname"
              class="field-input"
              autocomplete="given-name"
              [class.field-error]="showError('fname')"
            />
          </div>
          <div>
            <label class="field-label" for="lname">Last name</label>
            <input
              id="lname"
              formControlName="lname"
              class="field-input"
              autocomplete="family-name"
              [class.field-error]="showError('lname')"
            />
          </div>
        </div>
        <label class="field-label" for="email">Email</label>
        <input
          id="email"
          formControlName="email"
          type="email"
          class="field-input"
          autocomplete="username"
          [class.field-error]="showError('email')"
        />
        @if (showError('email')) {
          <small class="field-message">Enter a valid email address.</small>
        }

        <div class="password-label-row">
          <label class="field-label" for="password">Password</label>
          <span class="password-help">{{ MIN }}–{{ MAX }} characters</span>
        </div>
        <input
          id="password"
          formControlName="password"
          type="password"
          class="field-input"
          autocomplete="new-password"
          [class.field-error]="showError('password')"
        />
        @if (showError('password')) {
          <small class="field-message">Use {{ MIN }}–{{ MAX }} characters.</small>
        }

        <label class="field-label" for="confirm">Confirm password</label>
        <input
          id="confirm"
          formControlName="confirm"
          type="password"
          class="field-input"
          autocomplete="new-password"
          [class.field-error]="form.hasError('passwordsMatch') && form.controls.confirm.touched"
        />
        @if (form.hasError('passwordsMatch') && form.controls.confirm.touched) {
          <small class="field-message">Passwords do not match.</small>
        }

        <button type="submit" class="login-submit" [disabled]="busy()" [attr.aria-busy]="busy()">
          {{ busy() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
      <div class="login-footer">
        <span class="login-footer-dot"></span>
        <a routerLink="/login">Already registered? Sign in</a>
      </div>
    </gear-auth-page>
  `,
  styles: `
    .gear-two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 520px) {
      .gear-two {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class RegisterComponent {
  private readonly users = inject(UsersApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly MIN = PASSWORD_MIN_LENGTH;
  protected readonly MAX = PASSWORD_MAX_LENGTH;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup(
    {
      fname: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      lname: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email],
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(PASSWORD_MIN_LENGTH),
          Validators.maxLength(PASSWORD_MAX_LENGTH),
        ],
      }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: passwordsMatch },
  );

  protected showError(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected submit() {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const { confirm: _confirm, ...body } = this.form.getRawValue();
    this.users
      .register(body)
      .pipe(switchMap(() => this.auth.login({ email: body.email, password: body.password })))
      .subscribe({
        next: () => this.router.navigate(['/dashboard']),
        error: (err) => {
          this.error.set(apiErrorMessage(err, 'Could not create the account.'));
          this.busy.set(false);
        },
      });
  }
}
