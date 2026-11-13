import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AuthSessionService,
  LOCAL_STORAGE_KEY_ACCESS_TOKEN,
  LOCAL_STORAGE_KEY_REFRESH_TOKEN,
} from '@meshforge/manufacturing/frontend/data-access-user';
import { jwtInterceptor } from './jwt.interceptor';

const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
/** A decodable (unsigned) token; `name` keeps tokens distinguishable. */
const jwt = (name: string, sub = 'operator') =>
  `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, name, role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

describe('JWT credential boundaries and session renewal', () => {
  const oldAccess = jwt('old-access');
  const newAccess = jwt('new-access');
  let http: HttpClient;
  let backend: HttpTestingController;
  let session: AuthSessionService;
  let navigate: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN, oldAccess);
    localStorage.setItem(LOCAL_STORAGE_KEY_REFRESH_TOKEN, 'old-refresh');
    navigate = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([jwtInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { url: '/blades/dashboard', navigate } }] });
    http = TestBed.inject(HttpClient); backend = TestBed.inject(HttpTestingController);
    session = TestBed.inject(AuthSessionService);
  });
  afterEach(() => { backend.verify(); localStorage.clear(); });

  const unauthorized = { status: 401, statusText: 'Unauthorized' };
  const expectRefresh = (refreshToken = 'old-refresh') => {
    const req = backend.expectOne('/api/v1/auth/refresh');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${refreshToken}`);
    return req;
  };

  it('adds credentials to the same-origin API', () => {
    http.get('/api/v1/trays').subscribe();
    const req = backend.expectOne('/api/v1/trays');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${oldAccess}`); req.flush([]);
  });

  it.each(['/api/v1/auth/email/login', '/api/v1/auth/badge/login', '/api/v1/auth/google/login', '/api/v1/auth/email/forgot-password',
    '/api/v1/auth/email/reset-password?code=test', 'https://other.example/api/v1/trays'])('does not attach session credentials to %s', url => {
    http.get(url).subscribe(); const req = backend.expectOne(url);
    expect(req.request.headers.has('Authorization')).toBe(false); req.flush({});
  });

  it('keeps the signed-in user when a badge scan is refused at a kiosk', () => {
    http.post('/api/v1/auth/badge/login', { uid: 'CARD' }).subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/auth/badge/login').flush({}, unauthorized);
    expect(session.accessToken).toBe(oldAccess);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/auth/email/login', '/api/v1/auth/badge/login', '/api/v1/trays'])('treats a 429 from %s as a rate limit, not a session failure', (url) => {
    const errors: number[] = [];
    http.post(url, {}).subscribe({ error: e => errors.push(e.status) });
    backend.expectOne(url).flush({ message: 'Too many sign-in attempts. Wait 15 minutes, then try again.' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '900' } });
    backend.expectNone('/api/v1/auth/refresh');
    expect(errors).toEqual([429]);
    expect(session.accessToken).toBe(oldAccess);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renews an expired session once and sends the request again', () => {
    const received: unknown[] = [];
    http.get('/api/v1/trays').subscribe(body => received.push(body));
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    expectRefresh().flush({ accessToken: newAccess, refreshToken: 'new-refresh' });
    const retry = backend.expectOne('/api/v1/trays');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${newAccess}`);
    retry.flush(['T0001']);
    expect(received).toEqual([['T0001']]);
    expect(localStorage.getItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN)).toBe(newAccess);
    expect(localStorage.getItem(LOCAL_STORAGE_KEY_REFRESH_TOKEN)).toBe('new-refresh');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shares one renewal between concurrent rejected requests, including one that fails after it', () => {
    const received: unknown[] = [];
    http.get('/api/v1/trays').subscribe(body => received.push(body));
    http.get('/api/v1/locations').subscribe(body => received.push(body));
    http.get('/api/v1/containers').subscribe(body => received.push(body));
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    backend.expectOne('/api/v1/locations').flush({}, unauthorized);
    expectRefresh().flush({ accessToken: newAccess, refreshToken: 'new-refresh' });
    backend.expectOne('/api/v1/containers').flush({}, unauthorized);
    for (const url of ['/api/v1/trays', '/api/v1/locations', '/api/v1/containers']) {
      const retry = backend.expectOne(url);
      expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${newAccess}`);
      retry.flush(url);
    }
    expect(received).toHaveLength(3);
  });

  it('signs out and returns to sign-in once when the renewal is refused', () => {
    const errors: number[] = [];
    http.get('/api/v1/trays').subscribe({ error: e => errors.push(e.status) });
    http.get('/api/v1/locations').subscribe({ error: e => errors.push(e.status) });
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    backend.expectOne('/api/v1/locations').flush({}, unauthorized);
    expectRefresh().flush({ message: 'Session has been revoked' }, unauthorized);
    expect(errors).toEqual([401, 401]);
    expect(session.accessToken).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY_REFRESH_TOKEN)).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { redirectUrl: '/blades/dashboard' } });
  });

  it('keeps the session when the renewal fails for a network reason', () => {
    const errors: number[] = [];
    http.get('/api/v1/trays').subscribe({ error: e => errors.push(e.status) });
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    expectRefresh().flush({}, { status: 503, statusText: 'Unavailable' });
    expect(errors).toEqual([401]);
    expect(session.accessToken).toBe(oldAccess);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not renew twice when the renewed request is rejected again', () => {
    http.get('/api/v1/trays').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    expectRefresh().flush({ accessToken: newAccess, refreshToken: 'new-refresh' });
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    backend.expectNone('/api/v1/auth/refresh');
    expect(session.accessToken).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not clear a session on department denial', () => {
    http.get('/api/v1/trays').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/trays').flush({}, { status: 403, statusText: 'Forbidden' });
    backend.expectNone('/api/v1/auth/refresh');
    expect(session.accessToken).toBe(oldAccess); expect(navigate).not.toHaveBeenCalled();
  });

  it('does not clear a newer sign-in when an older request fails', () => {
    const newer = jwt('newer-login', 'supervisor');
    http.get('/api/v1/trays').subscribe({ error: () => undefined });
    session.login({ email: 'lead@example.com', password: 'x' }).subscribe();
    backend.expectOne('/api/v1/auth/email/login').flush({ accessToken: newer, refreshToken: 'newer-refresh' });
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    backend.expectNone('/api/v1/auth/refresh');
    expect(session.accessToken).toBe(newer); expect(navigate).not.toHaveBeenCalled();
  });

  it('never renews or signs out over a rejected refresh or explicit credential', () => {
    http.get('/api/v1/auth/refresh', { headers: { Authorization: 'Bearer refresh' } }).subscribe({ error: () => undefined });
    const req = backend.expectOne('/api/v1/auth/refresh'); expect(req.request.headers.get('Authorization')).toBe('Bearer refresh');
    req.flush({}, unauthorized);
    backend.expectNone('/api/v1/auth/refresh');
    expect(session.accessToken).toBe(oldAccess); expect(navigate).not.toHaveBeenCalled();
  });

  it('uses a renewal another tab already made instead of spending the old refresh token', () => {
    http.get('/api/v1/trays').subscribe();
    localStorage.setItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN, newAccess);
    localStorage.setItem(LOCAL_STORAGE_KEY_REFRESH_TOKEN, 'other-tab-refresh');
    backend.expectOne('/api/v1/trays').flush({}, unauthorized);
    backend.expectNone('/api/v1/auth/refresh');
    const retry = backend.expectOne('/api/v1/trays');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${newAccess}`);
    retry.flush([]);
    expect(session.refreshToken).toBe('other-tab-refresh');
  });
});

describe('Session shared between tabs', () => {
  let navigate: jest.Mock;
  let session: AuthSessionService;
  const access = jwt('tab-access');

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN, access);
    localStorage.setItem(LOCAL_STORAGE_KEY_REFRESH_TOKEN, 'tab-refresh');
    navigate = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: Router, useValue: { url: '/greenshed/shelves', navigate } }] });
    session = TestBed.inject(AuthSessionService);
  });
  afterEach(() => localStorage.clear());

  it('signs this tab out when another tab signs out', () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN);
    window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_STORAGE_KEY_ACCESS_TOKEN, oldValue: access, newValue: null }));
    expect(session.accessToken).toBeNull();
    expect(session.currentUser).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { redirectUrl: '/greenshed/shelves' } });
  });

  it('adopts tokens renewed in another tab without signing out', () => {
    const renewed = jwt('renewed');
    localStorage.setItem(LOCAL_STORAGE_KEY_REFRESH_TOKEN, 'renewed-refresh');
    window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_STORAGE_KEY_REFRESH_TOKEN }));
    localStorage.setItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN, renewed);
    window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_STORAGE_KEY_ACCESS_TOKEN }));
    expect(session.accessToken).toBe(renewed);
    expect(session.refreshToken).toBe('renewed-refresh');
    expect(session.wasRenewed(access)).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});
