import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { PasswordRecoveryComponent } from './password-recovery.component';

describe('PasswordRecoveryComponent', () => {
  let fixture: ComponentFixture<PasswordRecoveryComponent>;
  let component: PasswordRecoveryComponent;
  let http: HttpTestingController;
  let data: BehaviorSubject<{ mode: string }>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const code = 'a'.repeat(64);
  function create(mode = 'reset', token = code, passwordResetEnabled: boolean | undefined = true) {
    data = new BehaviorSubject({ mode });
    query = new BehaviorSubject(convertToParamMap({ code: token }));
    TestBed.configureTestingModule({
      imports: [PasswordRecoveryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { data, queryParamMap: query } },
      ],
    });
    fixture = TestBed.createComponent(PasswordRecoveryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http
      .expectOne('/api/v1/auth/capabilities')
      .flush({ registrationEnabled: false, ...(passwordResetEnabled === undefined ? {} : { passwordResetEnabled }) });
    fixture.detectChanges();
  }
  function valid(password = 'Valid-Password1!') {
    component.form.setValue({
      email: 'Operator@Example.com',
      password,
      confirmPassword: password,
    });
  }
  afterEach(() => {
    http?.verify();
  });
  it('submits forgot requests with a normalized email and no password', () => {
    create('forgot');
    component.form.controls.email.setValue('Operator@Example.com');
    component.submit();
    const req = http.expectOne('/api/v1/auth/email/forgot-password');
    expect(req.request.body).toEqual({ email: 'operator@example.com' });
    req.flush(null);
    expect(component.success).toBe(true);
    expect(component.form.controls.email.value).toBe('');
  });
  it('shows the wait the server asks for when too many requests were made', () => {
    create('forgot');
    component.form.controls.email.setValue('operator@example.com');
    component.submit();
    http.expectOne('/api/v1/auth/email/forgot-password')
      .flush({ message: 'Too many attempts. Wait 15 minutes, then try again.' }, { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '900' } });
    expect(component.error).toBe('Too many attempts. Wait 15 minutes, then try again.');
    expect(component.submitting).toBe(false);
  });
  it('replaces the forgot form with guidance when the server cannot send reset email', () => {
    create('forgot', code, false);
    expect(component.resetByEmailAvailable).toBe(false);
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Contact your MeshForge administrator');
  });
  it('keeps the forgot form when an older server does not report reset availability', () => {
    create('forgot', code, undefined);
    expect(component.resetByEmailAvailable).toBe(true);
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });
  it('does not send an invalid email', () => {
    create('forgot');
    component.form.controls.email.setValue('bad');
    component.submit();
    http.expectNone('/api/v1/auth/email/forgot-password');
    expect(component.error).toContain('valid email');
    fixture.detectChanges();
    const email = fixture.nativeElement.querySelector('#recovery-email') as HTMLInputElement;
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('aria-describedby')).toBe('recovery-email-error');
  });

  it('focuses and describes an unmatched confirmation without sending a reset', () => {
    create();
    valid();
    component.form.controls.confirmPassword.setValue('Different-Password1!');
    component.submit();
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector('#confirm-password') as HTMLInputElement;
    expect(document.activeElement).toBe(confirmation);
    expect(confirmation.getAttribute('aria-invalid')).toBe('true');
    expect(confirmation.getAttribute('aria-describedby')).toBe('recovery-confirm-error');
    expect(fixture.nativeElement.querySelector('#recovery-confirm-error').textContent).toContain('passwords must match');
    http.expectNone(request => request.method === 'POST');
  });
  it.each(['', 'abc', '../secret', 'z'.repeat(64)])(
    'does not submit an invalid reset link %s',
    (token) => {
      create('reset', token);
      valid();
      component.submit();
      expect(component.codeValid).toBe(false);
      http.expectNone((r) => r.method === 'POST');
    },
  );
  it('submits matching valid passwords with the link code as a query parameter', () => {
    create();
    valid();
    component.submit();
    const req = http.expectOne(
      '/api/v1/auth/email/reset-password?code=' + code,
    );
    expect(req.request.body).toEqual({
      email: 'operator@example.com',
      password: 'Valid-Password1!',
    });
    req.flush(null);
    expect(component.success).toBe(true);
    expect(component.form.controls.password.value).toBe('');
  });
  it.each(['Password1x', 'lowercase1!', 'UPPERCASE1!', 'NoNumber!', 'Aa1!'])(
    'rejects passwords outside the server policy: %s',
    (password) => {
      create();
      valid(password);
      component.submit();
      http.expectNone((r) => r.method === 'POST');
      expect(component.form.controls.password.invalid).toBe(true);
    },
  );
  it('accepts a backtick symbol rather than mistaking x or digits for symbols', () => {
    create();
    valid('Password1`');
    expect(component.form.valid).toBe(true);
    component.submit();
    http
      .expectOne('/api/v1/auth/email/reset-password?code=' + code)
      .flush(null);
  });
  it('enforces bcrypt UTF-8 byte length for multibyte passwords', () => {
    create();
    valid('Aa1!' + 'é'.repeat(35));
    component.submit();
    http.expectNone((r) => r.method === 'POST');
    expect(component.form.controls.password.invalid).toBe(true);
  });
  it('requires password confirmation', () => {
    create();
    valid();
    component.form.controls.confirmPassword.setValue('Different1!');
    component.submit();
    http.expectNone((r) => r.method === 'POST');
    expect(component.passwordsMatch).toBe(false);
  });
  it('prevents duplicate submissions while the request is in flight', () => {
    create();
    valid();
    component.submit();
    component.submit();
    const requests = http.match((r) => r.method === 'POST');
    expect(requests).toHaveLength(1);
    requests[0].flush(null);
  });
  it('shows expired-link guidance without displaying raw server content', () => {
    create();
    valid();
    component.submit();
    http
      .expectOne('/api/v1/auth/email/reset-password?code=' + code)
      .flush(
        { message: '<script>secret</script>' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(component.error).toContain('invalid or expired');
    expect(component.error).not.toContain('secret');
  });
  it('ignores a previous route response without unlocking the newer request', () => {
    create();
    valid();
    component.submit();
    const first = http.expectOne(
      '/api/v1/auth/email/reset-password?code=' + code,
    );
    query.next(convertToParamMap({ code: 'b'.repeat(64) }));
    valid();
    component.submit();
    const second = http.expectOne(
      '/api/v1/auth/email/reset-password?code=' + 'b'.repeat(64),
    );
    first.flush(null);
    expect(component.success).toBe(false);
    expect(component.submitting).toBe(true);
    second.flush(null);
    expect(component.success).toBe(true);
  });
  it('flushes native form controls on keyboard-style submit without blurring', () => {
    create('forgot');
    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('#recovery-email');
    input.value = 'operator@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    http.expectOne('/api/v1/auth/email/forgot-password').flush(null);
    expect(component.success).toBe(true);
  });
  it('cancels outstanding requests when leaving the recovery page', () => {
    create();
    valid();
    component.submit();
    const req = http.expectOne(
      '/api/v1/auth/email/reset-password?code=' + code,
    );
    fixture.destroy();
    expect(req.cancelled).toBe(true);
  });
});
