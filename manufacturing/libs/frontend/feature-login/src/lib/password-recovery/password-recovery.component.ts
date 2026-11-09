import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { combineLatest } from 'rxjs';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_NUMBER,
  PASSWORD_MIN_SYMBOL,
  PASSWORD_MIN_UPPERCASE,
} from '@libs/shared/util-constants';

function strongPassword(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  const bytes = Array.from(value).reduce((count, char) => {
    const point = char.codePointAt(0) ?? 0;
    return (
      count + (point > 0xffff ? 4 : point > 0x7ff ? 3 : point > 0x7f ? 2 : 1)
    );
  }, 0);
  const count = (pattern: RegExp) => value.match(pattern)?.length ?? 0;
  const valid =
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH &&
    bytes <= 72 &&
    count(/[a-z]/g) >= 1 &&
    count(/[A-Z]/g) >= PASSWORD_MIN_UPPERCASE &&
    count(/[0-9]/g) >= PASSWORD_MIN_NUMBER &&
    count(/[-#!$@£%^&*()_+|~=\x60{}[\]:";'<>?,./\\ ]/g) >= PASSWORD_MIN_SYMBOL;
  return valid ? null : { passwordPolicy: true };
}

@Component({
  selector: 'gear-password-recovery',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './password-recovery.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordRecoveryComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private code = '';
  mode: 'forgot' | 'reset' = 'forgot';
  codeValid = true;
  submitting = false;
  success = false;
  error = '';
  readonly minPasswordLength = PASSWORD_MIN_LENGTH;
  readonly maxPasswordLength = PASSWORD_MAX_LENGTH;
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
      updateOn: 'submit',
    }),
    password: new FormControl('', { nonNullable: true, updateOn: 'submit' }),
    confirmPassword: new FormControl('', {
      nonNullable: true,
      updateOn: 'submit',
    }),
  });
  constructor() {
    combineLatest([this.route.data, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([data, params]) => {
        ++this.generation;
        this.mode = data['mode'] === 'reset' ? 'reset' : 'forgot';
        this.code = params.get('code') ?? '';
        this.codeValid =
          this.mode === 'forgot' || /^[a-f0-9]{64}$/.test(this.code);
        this.submitting = this.success = false;
        this.error = '';
        this.form.reset();
        this.form.controls.password.setValidators(
          this.mode === 'reset' ? [Validators.required, strongPassword] : [],
        );
        this.form.controls.confirmPassword.setValidators(
          this.mode === 'reset' ? [Validators.required] : [],
        );
        this.form.controls.password.updateValueAndValidity();
        this.form.controls.confirmPassword.updateValueAndValidity();
        this.cdr.markForCheck();
      });
  }
  get passwordsMatch(): boolean {
    return (
      this.form.controls.password.value ===
      this.form.controls.confirmPassword.value
    );
  }
  submit(): void {
    if (this.submitting || this.success) return;
    this.error = '';
    this.form.controls.email.setValue(
      this.form.controls.email.value.trim().toLowerCase(),
    );
    if (
      !this.codeValid ||
      this.form.invalid ||
      (this.mode === 'reset' && !this.passwordsMatch)
    ) {
      this.form.markAllAsTouched();
      this.error = !this.codeValid
        ? 'This reset link is invalid. Request a new password reset link.'
        : 'Enter a valid email address' +
          (this.mode === 'reset'
            ? ' and matching passwords that meet the requirements.'
            : '.');
      return;
    }
    const generation = this.generation,
      mode = this.mode;
    const { email, password } = this.form.getRawValue();
    const request =
      mode === 'forgot'
        ? this.http.post<void>('/api/v1/auth/email/forgot-password', { email })
        : this.http.post<void>(
            '/api/v1/auth/email/reset-password',
            { email, password },
            { params: { code: this.code } },
          );
    this.submitting = true;
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (generation !== this.generation) return;
        this.submitting = false;
        this.success = true;
        this.form.reset();
        this.code = '';
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        if (generation !== this.generation) return;
        this.submitting = false;
        this.error =
          mode === 'forgot'
            ? 'Could not send the request right now. Please try again.'
            : error.status === 400 || error.status === 422
              ? 'The reset link is invalid or expired, or the account details do not match. Request a new link and try again.'
              : 'Could not reset your password right now. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }
}
