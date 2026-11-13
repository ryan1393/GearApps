import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
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
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@meshforge/manufacturing/shared/util-constants';

function strongPassword(control: AbstractControl): ValidationErrors | null {
  return isStrongPassword(control.value) ? null : { passwordPolicy: true };
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
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private generation = 0;
  private code = '';
  mode: 'forgot' | 'reset' = 'forgot';
  /** False when the server has no outgoing email: a reset link can never arrive, so say who can help instead. */
  resetByEmailAvailable = true;
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
    this.http
      .get<{ passwordResetEnabled?: boolean }>('/api/v1/auth/capabilities')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // Older servers do not report this; assume email works rather than block the form.
        next: (capabilities) => { this.resetByEmailAvailable = capabilities.passwordResetEnabled !== false; this.cdr.markForCheck(); },
        error: () => undefined,
      });
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
      const field = this.form.controls.email.invalid ? '#recovery-email'
        : this.form.controls.password.invalid ? '#new-password' : '#confirm-password';
      this.element.nativeElement.querySelector<HTMLInputElement>(field)?.focus();
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
        const serverMessage = typeof error.error?.message === 'string' ? error.error.message : '';
        this.error = error.status === 429 && serverMessage
          // Too many attempts: the server says how long to wait.
          ? serverMessage
          : mode === 'forgot'
            ? 'Could not send the request right now. Please try again.'
            : error.status === 400 || error.status === 422
              ? 'The reset link is invalid or expired, or the account details do not match. Request a new link and try again.'
              : 'Could not reset your password right now. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }
}
