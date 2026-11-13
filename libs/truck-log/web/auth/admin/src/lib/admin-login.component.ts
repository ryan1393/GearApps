import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TruckLogAdminAuth, safeAdminReturn } from './admin-auth.service';
/** Dana Apps page structure and form behavior, adapted to independent Truck Log accounts. */
@Component({ standalone: true, imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-login.component.html' })
export class TruckLogAdminLoginComponent implements OnInit {
  readonly auth = inject(TruckLogAdminAuth); private readonly router = inject(Router); private readonly route = inject(ActivatedRoute);
  readonly loginForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  loginError = ''; submitting = false; loginSucceeded = false; loading = false; ready = false; httpMode = false;
  get fEmail() { return this.loginForm.controls.email; }
  get fPassword() { return this.loginForm.controls.password; }
  /** Required-field styling is suppressed while valid credentials are pending or accepted. */
  get showIdentifierRequired() { return !this.submitting && !this.loginSucceeded && this.fEmail.invalid && (this.fEmail.touched || this.fEmail.dirty); }
  get showPasswordRequired() { return !this.submitting && !this.loginSucceeded && this.fPassword.invalid && (this.fPassword.touched || this.fPassword.dirty); }
  ngOnInit() {
    this.loading = true;
    this.auth.status().subscribe({ next: s => {
      this.loading = false; this.ready = this.auth.browserAllowed(); this.httpMode = this.ready && s.transport === 'internal-http';
      if (!this.ready) this.loginError = 'Truck Log sign-in has not been enabled at this address. Operator pages remain available.';
    }, error: () => { this.loading = false; this.loginError = 'Sign-in availability could not be checked. Check the connection and refresh this page.'; } });
  }
  /** Submit visible input values, even when the browser autofilled without firing input/blur events. */
  login(visibleIdentifier?: string, visiblePassword?: string) {
    if (this.submitting || !this.ready || !this.auth.browserAllowed()) return;
    this.loginSucceeded = false;
    this.loginError = '';
    const model = this.loginForm.getRawValue();
    const identifier = typeof visibleIdentifier === 'string' ? visibleIdentifier : model.email;
    const password = typeof visiblePassword === 'string' ? visiblePassword : model.password;
    // Browser autofill may not have updated the reactive controls; use the visible values for validation as well as submission.
    this.fEmail.setValue(identifier, { emitEvent: false });
    this.fPassword.setValue(password, { emitEvent: false });
    if (!identifier.trim() || !password) {
      this.loginForm.markAllAsTouched(); this.loginError = 'Enter your username or email and password.'; return;
    }
    this.submitting = true;
    this.auth.login(identifier, password).subscribe({ next: session => {
      this.loginSucceeded = true;
      this.fPassword.setValue(''); this.submitting = false;
      void this.router.navigateByUrl(session.user.mustChangePassword ? '/admin/password' : safeAdminReturn(this.route.snapshot.queryParamMap.get('returnTo')));
    }, error: e => {
      this.fPassword.setValue(''); this.submitting = false;
      this.loginError = typeof e?.error?.message === 'string' ? e.error.message : 'Unable to sign in. Check your username or email and password.';
    } });
  }
}
@Component({ standalone: true, imports: [CommonModule, FormsModule, RouterLink],
 template: `<div class="tl-auth-narrow">
 <section class="dana-panel">
 <div class="dana-panel-header"><div><h2>Change my password</h2><small>15–128 characters. Spaces and password managers are fine.</small></div></div>
 <div class="dana-panel-body tl-stack">
 <p class="dana-alert dana-alert-warning" *ngIf="auth.user()?.mustChangePassword">Change your temporary password before making administrative changes.</p>
 <p class="dana-page-description">Changing your password signs out all of your Truck Log sessions.</p>
 <p class="dana-alert dana-alert-danger" *ngIf="error" role="alert">{{error}}</p>
 <p class="dana-alert dana-alert-success" *ngIf="done" role="status">Password changed. <a routerLink="/admin/login">Sign in with your new password.</a></p>
 <form *ngIf="!done" (ngSubmit)="save()"><fieldset class="tl-stack tl-fieldset" [disabled]="busy">
 <label class="dana-field">Current password<input class="dana-input" name="currentPassword" type="password" [(ngModel)]="currentPassword" autocomplete="current-password" required></label>
 <label class="dana-field">New password<input class="dana-input" name="newPassword" type="password" [(ngModel)]="nextPassword" autocomplete="new-password" required minlength="15" maxlength="256"></label>
 <label class="dana-field">Confirm new password<input class="dana-input" name="confirmPassword" type="password" [(ngModel)]="confirmPassword" autocomplete="new-password" required maxlength="256"></label>
 <div class="dana-actions"><button class="dana-btn dana-btn-primary" type="submit">{{busy ? 'Saving…' : 'Save new password'}}</button><a class="dana-btn dana-btn-ghost" routerLink="/">Return to operator pages</a></div>
 </fieldset></form>
 </div></section></div>`
})
export class TruckLogAdminPasswordComponent {
  readonly auth = inject(TruckLogAdminAuth); currentPassword = ''; nextPassword = ''; confirmPassword = ''; error = ''; busy = false; done = false;
  save() { if (this.busy) return; this.error = '';
    if (this.nextPassword !== this.confirmPassword) { this.error = 'The new passwords do not match.'; return; }
    if ([...this.nextPassword].length < 15 || [...this.nextPassword].length > 128) { this.error = 'Use 15–128 characters.'; return; }
    this.busy = true; this.auth.changePassword(this.currentPassword, this.nextPassword).subscribe({ next: () => { this.busy = false; this.done = true; this.clearPasswords(); }, error: e => { this.busy = false; this.clearPasswords(); this.error = e?.error?.message || 'Password change was not confirmed.'; } });
  }
  private clearPasswords() { this.currentPassword = ''; this.nextPassword = ''; this.confirmPassword = ''; }
}
