import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { FrontendFeatureLoginComponent } from './frontend-feature-login.component';

describe('FrontendFeatureLoginComponent', () => {
  let fixture: ComponentFixture<FrontendFeatureLoginComponent>;
  let login: jest.Mock;
  let loginBadge: jest.Mock;
  beforeEach(async () => {
    login = jest.fn(() => of({ accessToken: 'access', refreshToken: 'refresh' }));
    loginBadge = jest.fn(() => of({ accessToken: 'access', refreshToken: 'refresh' }));
    await TestBed.configureTestingModule({ imports: [FrontendFeatureLoginComponent], providers: [
      { provide: AuthSessionService, useValue: { authState$: of(null), login, loginBadge } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      { provide: Router, useValue: { navigate: jest.fn().mockResolvedValue(true), navigateByUrl: jest.fn().mockResolvedValue(true) } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(FrontendFeatureLoginComponent); fixture.detectChanges();
  });
  it('creates the sign-in form', () => expect(fixture.componentInstance).toBeTruthy());
  it('submits the typed password without requiring the field to blur', () => {
    const email: HTMLInputElement = fixture.nativeElement.querySelector('#email');
    const password: HTMLInputElement = fixture.nativeElement.querySelector('#password');
    email.value = 'operator@example.com'; email.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'Password1!'; password.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(login).toHaveBeenCalledWith({ email: 'operator@example.com', password: 'Password1!' });
  });

  it('focuses the first invalid field and associates its error for keyboard and screen-reader users', () => {
    fixture.componentInstance.login();
    fixture.detectChanges();
    const email = fixture.nativeElement.querySelector('#email') as HTMLInputElement;
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBe('email-error');
    expect(login).not.toHaveBeenCalled();
  });

  it('accepts a short password from an account created under an older policy', () => {
    fixture.componentInstance.loginForm.setValue({ email: 'operator@example.com', password: 'short' });
    fixture.componentInstance.login();
    expect(login).toHaveBeenCalledWith({ email: 'operator@example.com', password: 'short' });
  });

  it('still requires a password', () => {
    fixture.componentInstance.loginForm.setValue({ email: 'operator@example.com', password: '' });
    fixture.componentInstance.login();
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#password'));
    expect(fixture.nativeElement.querySelector('#password-error').textContent).toContain('Password is required.');
    expect(login).not.toHaveBeenCalled();
  });

  it('shows badge-specific progress and prevents duplicate Enter submissions', () => {
    const pending = new Subject();
    loginBadge.mockReturnValue(pending);
    const component = fixture.componentInstance;
    component.badgeUid = 'CARD-123';
    component.loginBadge();
    component.badgeUid = 'CARD-123';
    component.loginBadge();
    fixture.detectChanges();
    expect(loginBadge).toHaveBeenCalledTimes(1);
    expect(loginBadge).toHaveBeenCalledWith('CARD-123');
    expect(fixture.nativeElement.textContent).toContain('Signing in with badge…');
    expect((fixture.nativeElement.querySelector('#email') as HTMLInputElement).readOnly).toBe(true);
    pending.complete();
  });

  it('keeps the badge field focusable during sign-in and says to wait when another scan arrives', () => {
    const pending = new Subject();
    loginBadge.mockReturnValue(pending);
    const component = fixture.componentInstance;
    component.badgeUid = 'CARD-123';
    component.loginBadge();
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('#badge-uid') as HTMLInputElement;
    expect(badge.disabled).toBe(false);
    expect(badge.readOnly).toBe(true);
    expect(badge.getAttribute('aria-busy')).toBe('true');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    badge.dispatchEvent(enter);
    fixture.detectChanges();
    expect(enter.defaultPrevented).toBe(true);
    expect(fixture.nativeElement.querySelector('#badge-notice').textContent).toContain('Wait — still signing in');
    expect(loginBadge).toHaveBeenCalledTimes(1);
    pending.complete();
  });

  it('returns focus to the badge scanner input after a refused scan', () => {
    loginBadge.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401, error: { message: 'Badge not recognized.' } })));
    fixture.componentInstance.badgeUid = 'CARD-123';
    fixture.componentInstance.loginBadge();
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#badge-uid'));
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Badge not recognized.');
    expect(fixture.componentInstance.submitting).toBe(false);
    expect(fixture.componentInstance.badgeUid).toBe('');
  });
});
