import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from './auth.service';

const token = (exp: number) => {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=/g, '');
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', email: 'a@b.c', firstName: 'Ryan', tokenUse: 'access', exp })}.sig`;
};

describe('AuthService', () => {
  let http: { post: jest.Mock };
  beforeEach(() => {
    localStorage.clear();
    http = { post: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
  });

  it('stores the token on login and exposes decoded user data', () => {
    const t = token(Math.floor(Date.now() / 1000) + 3600);
    http.post.mockReturnValue(of({ accessToken: t, refreshToken: 'refresh' }));
    const svc = TestBed.inject(AuthService);
    svc.login({ email: 'a@b.c', password: 'x' }).subscribe();
    expect(svc.isAuthenticated()).toBe(true);
    expect(svc.userId()).toBe('u1');
    expect(svc.displayName()).toBe('Ryan');
    expect(localStorage.getItem('gearapps.token')).toBe(t);
  });

  it('treats an expired token as unauthenticated and clears on logout', () => {
    localStorage.setItem('gearapps.token', token(Math.floor(Date.now() / 1000) - 10));
    const svc = TestBed.inject(AuthService);
    expect(svc.isAuthenticated()).toBe(false);
    svc.logout();
    expect(svc.user()).toBeNull();
    expect(localStorage.getItem('gearapps.token')).toBeNull();
  });
});
