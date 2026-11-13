import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, catchError, map, of, tap, throwError, timeout, switchMap } from 'rxjs';

export interface TruckLogAdminUser { id: string; username: string; email: string | null; displayName: string; enabled: boolean; mustChangePassword: boolean; }
interface Session { user: TruckLogAdminUser; csrf: string; expiresAt: string; }
const ROOT = '/api/v1/admin-auth';
export const TRUCK_LOG_ADMIN_UI_VERSION = 'truck-log-admin-v1';
export const TRUCK_LOG_ADMIN_LOGIN_VERSION = 'truck-log-admin-login-v1';
export interface AdminAvailability { version: string; loginVersion: string; enabled: boolean; configured: boolean; transport: 'https' | 'internal-http'; origin: string; }
export function availabilityMatches(value: AdminAvailability, browserOrigin: string): boolean {
  if (!value?.enabled || !value.configured || value.version !== TRUCK_LOG_ADMIN_UI_VERSION || value.loginVersion !== TRUCK_LOG_ADMIN_LOGIN_VERSION || value.origin !== browserOrigin) return false;
  try { const scheme = new URL(browserOrigin).protocol; return (value.transport === 'https' && scheme === 'https:') || (value.transport === 'internal-http' && scheme === 'http:'); } catch { return false; }
}
export function adminMutation(method: string, pathname: string): boolean {
  return !['GET','HEAD','OPTIONS'].includes(method.toUpperCase())
    && /^\/api\/v1\/(?:admin-auth|admin\/packing-slip-routes|settings|reference-data|docks|scheduled-loads|stations|rxo\/control|rxo\/expedite|rxo\/import-latest)(?:\/|$)/.test(pathname);
}
export function safeAdminReturn(value: string | null): string {
  return ['/admin','/admin/users','/admin/stations','/rxo','/rxo-expedite'].includes(value || '') ? value! : '/admin';
}
@Injectable({ providedIn: 'root' })
export class TruckLogAdminAuth {
  readonly user = signal<TruckLogAdminUser | null>(null);
  readonly sessionProblem = signal('');
  private csrf = '';
  private availability: AdminAvailability | null = null;
  private expires = 0;
  private readonly http = inject(HttpClient);
  secureBrowser() { return typeof location !== 'undefined' && location.protocol === 'https:'; }
  browserAllowed() { return typeof location !== 'undefined' && !!this.availability && availabilityMatches(this.availability, location.origin); }
  canWrite() { return this.browserAllowed() && !!this.user()?.enabled && !this.user()?.mustChangePassword && this.expires > Date.now(); }
  csrfValue() { return this.csrf; }
  clear() { this.csrf = ''; this.expires = 0; this.user.set(null); }
  private adopt(s: Session) {
    if (!s?.user?.enabled || typeof s.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(s.csrf) || !Number.isFinite(Date.parse(s.expiresAt))) throw new Error('Invalid Truck Log session response');
    this.user.set(s.user); this.csrf = s.csrf; this.expires = Date.parse(s.expiresAt); this.sessionProblem.set('');
  }
  status() { return this.http.get<AdminAvailability>(ROOT + '/status').pipe(timeout(10000), map(value => {
    if (value.version !== TRUCK_LOG_ADMIN_UI_VERSION || value.loginVersion !== TRUCK_LOG_ADMIN_LOGIN_VERSION) { this.availability = null; this.clear(); throw new Error('Truck Log Admin API/web version mismatch.'); }
    this.availability = value; return value;
  }), catchError(e => { this.availability = null; this.clear(); return throwError(() => e); })); }
  refresh(): Observable<TruckLogAdminUser | null> {
    return this.status().pipe(switchMap(() => {
      if (!this.browserAllowed()) { this.clear(); this.sessionProblem.set('Administrator sign-in is not enabled at this address. Operator pages remain available.'); return of(null); }
      return this.http.get<Session>(ROOT + '/session').pipe(timeout(10000), tap(s => this.adopt(s)), map(s => s.user));
    }), catchError((e: HttpErrorResponse) => {
      this.clear(); this.sessionProblem.set(e.status === 401 ? '' : (e.error?.message || 'Administrator sign-in is unavailable.')); return of(null);
    }));
  }
  login(identifier: string, password: string): Observable<Session> {
    if (!this.browserAllowed()) return throwError(() => new Error('Administrator sign-in is not enabled at this address.'));
    return this.http.post<Session>(ROOT + '/login', { identifier, password }).pipe(timeout(20000), tap(s => this.adopt(s)));
  }
  logout() { return this.http.post(ROOT + '/logout', {}).pipe(timeout(10000), tap(() => this.clear())); }
  changePassword(currentPassword: string, password: string) { return this.http.post(ROOT + '/password', { currentPassword, password }).pipe(timeout(20000), tap(() => this.clear())); }
  users() { return this.http.get<TruckLogAdminUser[]>(ROOT + '/users').pipe(timeout(10000)); }
  create(values: { displayName: string; username: string; email: string; password: string }) { return this.http.post<TruckLogAdminUser>(ROOT + '/users', values).pipe(timeout(20000)); }
  update(id: string, values: { displayName?: string; email?: string; enabled?: boolean }) { return this.http.patch<TruckLogAdminUser>(ROOT + '/users/' + encodeURIComponent(id), values).pipe(timeout(10000)); }
  reset(id: string, password: string) { return this.http.post(ROOT + '/users/' + encodeURIComponent(id) + '/reset-password', { password }).pipe(timeout(20000)); }
}
export const truckLogAdminInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(TruckLogAdminAuth);
  const base = typeof location !== 'undefined' ? location.origin : 'http://localhost';
  const url = new URL(req.url, base);
  if (url.origin !== base || !adminMutation(req.method, url.pathname)) return next(req);
  if (!auth.browserAllowed()) return throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'ADMIN_SETUP_REQUIRED', message: 'Administrator sign-in is not enabled at this address.' } }));
  const headers: Record<string, string> = { 'X-TruckLog-Admin-Request': '1' };
  if (auth.csrfValue()) headers['X-TruckLog-Admin-CSRF'] = auth.csrfValue();
  return next(req.clone({ setHeaders: headers })).pipe(catchError((error: HttpErrorResponse) => {
    if (error.status === 401 && error.error?.code === 'ADMIN_SESSION_REQUIRED') auth.clear();
    return throwError(() => error);
  }));
};
export const truckLogAdminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(TruckLogAdminAuth), router = inject(Router);
  return auth.refresh().pipe(map(user => {
    if (!user) return router.createUrlTree(['/admin/login'], { queryParams: { returnTo: safeAdminReturn(state.url) } });
    if (user.mustChangePassword && state.url !== '/admin/password') return router.createUrlTree(['/admin/password']);
    return true;
  }));
};
