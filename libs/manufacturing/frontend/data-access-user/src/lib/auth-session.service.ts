import { jwtDecode } from 'jwt-decode';
import {
  BehaviorSubject,
  defer,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  Subscription,
  tap,
  throwError,
} from 'rxjs';

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable, Injector, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import {
  AccessToken,
  IJwtPayload,
  ITokenResponse,
  IUserLogin,
  RefreshToken,
} from '@meshforge/manufacturing/shared/util-types';

import {
  AUTH_REFRESH_PATH,
  LOCAL_STORAGE_KEY_ACCESS_TOKEN,
  LOCAL_STORAGE_KEY_REFRESH_TOKEN,
  REDIRECT_URL_QUERY_PARAM,
} from './constants';

/** The server answered the refresh: the session is over and the user must sign in again. */
export class SessionRefreshRejectedError extends Error {
  constructor() {
    super('The session could not be renewed. Sign in again.');
    this.name = 'SessionRefreshRejectedError';
  }
}

/** Routes that already let a signed-out user sign in again. */
const SIGN_IN_ROUTE = /^\/(login|forgot-password|reset-password)(?:[/?#]|$)/;

/** Held while one tab renews the session so another tab never spends the same refresh token. */
const REFRESH_LOCK = 'meshforge-auth-refresh';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private readonly zone = inject(NgZone, { optional: true });
  private readonly userDataSubject = new BehaviorSubject<IJwtPayload | null>(null);
  private _accessToken: AccessToken | null = null;
  private _refreshToken: RefreshToken | null = null;
  /** Bumped on every sign-in and sign-out: a renewal that started before it is discarded. */
  private generation = 0;
  private refreshInFlight: Observable<AccessToken> | null = null;
  /** Access tokens replaced by a renewal; a request rejected with one of them may be sent again. */
  private readonly renewedTokens = new Set<AccessToken>();

  readonly authState$ = this.userDataSubject.asObservable();
  readonly isLoggedIn$ = this.authState$.pipe(map(Boolean));

  constructor() {
    this.accessToken = this.readToken(LOCAL_STORAGE_KEY_ACCESS_TOKEN);
    this.refreshToken = this.readToken(LOCAL_STORAGE_KEY_REFRESH_TOKEN);
    if (typeof window !== 'undefined') {
      const listener = (event: StorageEvent) => this.onStorage(event);
      window.addEventListener('storage', listener);
      inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', listener));
    }
  }

  get currentUser(): IJwtPayload | null {
    return this.userDataSubject.value;
  }

  get accessToken(): AccessToken | null { return this._accessToken; }
  set accessToken(value: AccessToken | null) {
    this._accessToken = value;
    this.writeToken(LOCAL_STORAGE_KEY_ACCESS_TOKEN, value);
    this.userDataSubject.next(value ? this.decodeAccessToken(value) : null);
  }

  get refreshToken(): RefreshToken | null { return this._refreshToken; }
  set refreshToken(value: RefreshToken | null) {
    this._refreshToken = value;
    this.writeToken(LOCAL_STORAGE_KEY_REFRESH_TOKEN, value);
  }

  get tokenExpired(): boolean {
    const exp = this.userDataSubject.value?.exp;
    return !exp || Date.now() >= exp * 1000;
  }

  login(dto: IUserLogin): Observable<ITokenResponse> {
    return this.http.post<ITokenResponse>('/api/v1/auth/email/login', dto).pipe(
      tap((tokens) => this.startSession(tokens)),
    );
  }

  loginBadge(uid: string): Observable<ITokenResponse> {
    return this.http.post<ITokenResponse>('/api/v1/auth/badge/login', { uid }).pipe(
      tap((tokens) => this.startSession(tokens)),
    );
  }

  logout(): void {
    this.generation++;
    this.refreshInFlight = null;
    this.renewedTokens.clear();
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Exchanges the refresh token for a new pair and stores it. Callers that ask while a renewal
   * is running share it, and tabs take turns, so one refresh token is never spent twice.
   * Errors with {@link SessionRefreshRejectedError} (after signing out) when the server refuses it;
   * other failures (network, server error) leave the session as it is.
   */
  refreshSession(): Observable<AccessToken> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const generation = this.generation;
    const staleAccess = this._accessToken;
    const staleRefresh = this._refreshToken;
    if (!staleRefresh) {
      // Nothing to renew with: the session is over.
      this.logout();
      return throwError(() => new SessionRefreshRejectedError());
    }

    this.refreshInFlight = this.withRefreshLock(() => {
      if (generation !== this.generation) return throwError(() => new SessionRefreshRejectedError());
      // Another tab may have renewed the session while this one waited for the lock.
      const storedRefresh = this.readToken(LOCAL_STORAGE_KEY_REFRESH_TOKEN);
      const storedAccess = this.readToken(LOCAL_STORAGE_KEY_ACCESS_TOKEN);
      if (storedRefresh && storedAccess && storedRefresh !== staleRefresh) {
        this.adoptRenewal(staleAccess, storedAccess, storedRefresh);
        return of(storedAccess);
      }
      return this.http
        .get<ITokenResponse>(AUTH_REFRESH_PATH, { headers: { Authorization: `Bearer ${staleRefresh}` } })
        .pipe(map(({ accessToken, refreshToken }) => {
          if (generation !== this.generation) throw new SessionRefreshRejectedError();
          this.adoptRenewal(staleAccess, accessToken, refreshToken);
          return accessToken;
        }));
    }).pipe(
      tap({
        error: (error: unknown) => {
          const refused = error instanceof SessionRefreshRejectedError ||
            (error instanceof HttpErrorResponse && [400, 401, 403].includes(error.status));
          if (refused && generation === this.generation) this.logout();
        },
      }),
      finalize(() => { if (this.refreshInFlight === shared) this.refreshInFlight = null; }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    const shared = this.refreshInFlight;
    return shared;
  }

  /** True when `token` was replaced by a renewal of this session (not by a sign-in or sign-out). */
  wasRenewed(token: AccessToken): boolean {
    return this.renewedTokens.has(token);
  }

  private startSession({ accessToken, refreshToken }: ITokenResponse): void {
    this.generation++;
    this.refreshInFlight = null;
    this.renewedTokens.clear();
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  private adoptRenewal(previous: AccessToken | null, accessToken: AccessToken, refreshToken: RefreshToken): void {
    if (previous) this.renewedTokens.add(previous);
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  /** Runs `work` while holding a lock shared by every tab of this app (where the browser supports it). */
  private withRefreshLock<T>(work: () => Observable<T>): Observable<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks?.request) return defer(work);
    return new Observable<T>((subscriber) => {
      let inner: Subscription | undefined;
      locks.request(REFRESH_LOCK, () => new Promise<void>((release) => {
        if (subscriber.closed) { release(); return; }
        const run = () => {
          inner = defer(work).pipe(finalize(() => release())).subscribe(subscriber);
        };
        if (this.zone) this.zone.run(run); else run();
      })).catch((error: unknown) => subscriber.error(error));
      return () => inner?.unsubscribe();
    });
  }

  /** Keeps tabs of one app in step: a sign-out or renewal in one tab applies to all of them. */
  private onStorage(event: StorageEvent): void {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== null && event.key !== LOCAL_STORAGE_KEY_ACCESS_TOKEN && event.key !== LOCAL_STORAGE_KEY_REFRESH_TOKEN) return;
    const access = this.readToken(LOCAL_STORAGE_KEY_ACCESS_TOKEN);
    const refresh = this.readToken(LOCAL_STORAGE_KEY_REFRESH_TOKEN);
    const wasSignedIn = !!this._accessToken;
    if (refresh !== this._refreshToken) this._refreshToken = refresh;
    if (access === this._accessToken) return;

    const run = () => {
      if (!access) {
        this.generation++;
        this.refreshInFlight = null;
        this.renewedTokens.clear();
        this._accessToken = null;
        this.userDataSubject.next(null);
        if (wasSignedIn) this.showSignIn();
        return;
      }
      const sameUser = !!this._accessToken && this.decodeQuietly(access)?.sub === this.currentUser?.sub;
      if (sameUser && this._accessToken) this.renewedTokens.add(this._accessToken);
      else { this.generation++; this.refreshInFlight = null; }
      this._accessToken = access;
      this.userDataSubject.next(this.decodeQuietly(access));
    };
    if (this.zone) this.zone.run(run); else run();
  }

  private showSignIn(): void {
    const router = this.injector.get(Router, null);
    if (!router) return;
    const current = router.url;
    if (SIGN_IN_ROUTE.test(current)) return;
    void router.navigate(['/login'], { queryParams: { [REDIRECT_URL_QUERY_PARAM]: current } });
  }

  private readToken(key: string): string | null {
    const value = localStorage.getItem(key);
    return value && value !== 'null' && value !== 'undefined' ? value : null;
  }

  private writeToken(key: string, value: string | null): void {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }

  private decodeQuietly(token: string): IJwtPayload | null {
    try { return jwtDecode<IJwtPayload>(token); } catch { return null; }
  }

  private decodeAccessToken(token: string): IJwtPayload | null {
    try {
      return jwtDecode<IJwtPayload>(token);
    } catch {
      localStorage.removeItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN);
      this._accessToken = null;
      return null;
    }
  }
}
