import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { DanaAlertDirective, DanaButtonDirective } from '@dana/ui';

@Component({
  selector: 'gear-plant-login', standalone: true, imports: [FormsModule, DanaAlertDirective, DanaButtonDirective],
  styleUrls: ['./plant-layout.css'],
  template: `<main class="login-page plant-sign-in">
    <section class="login-form-panel">
      <div class="login-card">
        <header class="plant-login-copy">
          <p class="gear-eyebrow">MESHFORGE / PLANT INTELLIGENCE</p>
          <h1 class="gear-page-title">The whole floor.<br />One clear view.</h1>
          <p class="gear-muted">Sign in with your MeshForge account to view machine production and reports.</p>
        </header>
        <form class="login-form plant-login-form" #form="ngForm" (ngSubmit)="login()" [attr.aria-busy]="busy()">
          <label class="gear-field" for="email">Email address
            <input class="gear-input" id="email" name="email" type="email" autocomplete="username" [(ngModel)]="email" [readOnly]="busy()" required email />
          </label>
          <label class="gear-field" for="password">Password
            <input class="gear-input" id="password" name="password" type="password" autocomplete="current-password" [(ngModel)]="password" [readOnly]="busy()" required />
          </label>
          @if (error()) { <p role="alert" danaAlert="warning">{{ error() }}</p> }
          <button danaButton="primary" type="submit" [disabled]="form.invalid || busy()" [attr.aria-busy]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        </form>
        <p class="gear-field-help">Uses the shared MeshForge sign-in service.</p>
      </div>
    </section>
  </main>`,
})
export class LoginComponent {
  private readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');

  login(): void {
    if (this.busy() || !this.email || !this.password) return;
    this.busy.set(true);
    this.error.set('');
    this.session.login({ email: this.email.trim(), password: this.password }).subscribe({
      next: () => { this.password = ''; this.busy.set(false); void this.router.navigateByUrl('/'); },
      error: (error: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(error.status === 0 || error.status >= 500
          ? 'MeshForge is unavailable. Please try again shortly.'
          : 'Unable to sign in. Check your email and password.');
      },
    });
  }
}
