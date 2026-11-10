import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { AuthSessionService, LOCAL_STORAGE_KEY_ACCESS_TOKEN } from '@gearapps/manufacturing/frontend/data-access-user';

describe('Auth session JWT decoding', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: {} }] });
  });
  afterEach(() => localStorage.clear());

  it('restores department and role claims using the shared jwt-decode version', () => {
    const payload = { sub: 'operator', email: 'operator@example.test', role: 'user', departmentCode: '45', exp: Math.floor(Date.now() / 1000) + 3600 };
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.test-signature`;
    localStorage.setItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN, token);
    const session = TestBed.inject(AuthSessionService);
    expect(session.currentUser).toMatchObject(payload);
    expect(session.accessToken).toBe(token);
    expect(session.tokenExpired).toBe(false);
  });

  it('clears malformed saved tokens instead of breaking application startup', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN, 'invalid');
    const session = TestBed.inject(AuthSessionService);
    expect(session.accessToken).toBeNull();
    expect(session.currentUser).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN)).toBeNull();
    expect(session.tokenExpired).toBe(true);
  });
});
