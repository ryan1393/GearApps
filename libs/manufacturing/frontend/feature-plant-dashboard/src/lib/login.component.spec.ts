import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { throwError } from 'rxjs';

import { LoginComponent } from './login.component';

describe('Plant dashboard sign-in', () => {
  function signInFails(status: number, message?: string) {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthSessionService, useValue: { login: () => throwError(() => new HttpErrorResponse({ status, error: message ? { message } : null })) } },
        { provide: Router, useValue: { navigateByUrl: jest.fn() } },
      ],
    });
    const component = TestBed.createComponent(LoginComponent).componentInstance;
    component.email = 'lead@example.com';
    component.password = 'secret';
    component.login();
    return component;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows the wait the server asks for after too many attempts', () => {
    expect(signInFails(429, 'Too many sign-in attempts. Wait 15 minutes, then try again.').error())
      .toBe('Too many sign-in attempts. Wait 15 minutes, then try again.');
  });

  it('keeps wrong credentials generic', () => {
    expect(signInFails(401, 'Invalid email or password').error()).toBe('Unable to sign in. Check your email and password.');
  });

  it('reports an outage separately', () => {
    expect(signInFails(503).error()).toBe('MeshForge is unavailable. Please try again shortly.');
  });
});
