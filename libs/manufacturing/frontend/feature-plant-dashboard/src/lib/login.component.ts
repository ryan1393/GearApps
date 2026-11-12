import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';

@Component({
  selector: 'gear-plant-login', standalone: true, imports: [FormsModule],
  styleUrls: ['./plant-layout.css'],
  template: `<main class="sign-in">
    <section class="sign-in-card">
      <p class="eyebrow">MESHFORGE / PLANT INTELLIGENCE</p>
      <h1>The whole floor.<br />One clear view.</h1>
      <p class="muted">Sign in with your MeshForge account to view machine production and reports.</p>
      <form #form="ngForm" (ngSubmit)="login()">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" autocomplete="username" [(ngModel)]="email" required email />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" [(ngModel)]="password" required />
        @if (error()) { <p role="alert" class="notice warning">{{ error() }}</p> }
        <button class="primary" type="submit" [disabled]="form.invalid || busy()" [attr.aria-busy]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      </form>
      <p class="muted small">Uses the shared MeshForge sign-in service.</p>
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
