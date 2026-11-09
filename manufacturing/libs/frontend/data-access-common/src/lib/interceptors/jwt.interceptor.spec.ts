import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthSessionService } from '@libs/frontend/data-access-user';
import { jwtInterceptor } from './jwt.interceptor';

describe('JWT credential boundaries and session recovery', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let token: string | null;
  let session: { readonly accessToken: string | null; logout: jest.Mock };
  let navigate: jest.Mock;
  beforeEach(() => {
    token = 'old-access';
    navigate = jest.fn().mockResolvedValue(true);
    session = { get accessToken() { return token; }, logout: jest.fn(() => { token = null; }) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([jwtInterceptor])), provideHttpClientTesting(),
      { provide: AuthSessionService, useValue: session }, { provide: Router, useValue: { url: '/blades/dashboard', navigate } }] });
    http = TestBed.inject(HttpClient); backend = TestBed.inject(HttpTestingController);
  });
  afterEach(() => backend.verify());
  it('adds credentials to the same-origin API', () => {
    http.get('/api/v1/trays').subscribe();
    const req = backend.expectOne('/api/v1/trays');
    expect(req.request.headers.get('Authorization')).toBe('Bearer old-access'); req.flush([]);
  });
  it.each(['/api/v1/auth/email/login', '/api/v1/auth/google/login', '/api/v1/auth/email/forgot-password', '/api/v1/auth/email/reset-password?code=test', 'https://other.example/api/v1/trays'])('does not attach session credentials to %s', url => {
    http.get(url).subscribe(); const req = backend.expectOne(url);
    expect(req.request.headers.has('Authorization')).toBe(false); req.flush({});
  });
  it('clears an authenticated 401 and redirects to login', () => {
    http.get('/api/v1/trays').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/trays').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(session.logout).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledTimes(1);
  });
  it('does not clear a session on department denial', () => {
    http.get('/api/v1/trays').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/trays').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(session.logout).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it('does not clear a newer login when an older request fails', () => {
    http.get('/api/v1/trays').subscribe({ error: () => undefined }); token = 'new-access';
    backend.expectOne('/api/v1/trays').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(session.logout).not.toHaveBeenCalled(); expect(token).toBe('new-access');
  });
  it('preserves an explicitly supplied refresh credential', () => {
    http.get('/api/v1/auth/refresh', { headers: { Authorization: 'Bearer refresh' } }).subscribe({ error: () => undefined });
    const req = backend.expectOne('/api/v1/auth/refresh'); expect(req.request.headers.get('Authorization')).toBe('Bearer refresh');
    req.flush({}, { status: 401, statusText: 'Unauthorized' }); expect(session.logout).not.toHaveBeenCalled();
  });
  it('redirects only once for concurrent rejected requests', () => {
    http.get('/api/v1/trays').subscribe({ error: () => undefined });
    http.get('/api/v1/locations').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/trays').flush({}, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/v1/locations').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(session.logout).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledTimes(1);
  });
});
