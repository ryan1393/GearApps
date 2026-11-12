import { HttpErrorResponse, HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import {
  AUTH_REFRESH_PATH,
  AuthSessionService,
  SessionRefreshRejectedError,
} from '@meshforge/manufacturing/frontend/data-access-user';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { REDIRECT_URL_QUERY_PARAM } from '../constants';

/** Sign-in calls never carry the session's credentials and never trigger a renewal. */
const publicAuthPaths = new Set([
  '/api/v1/auth/email/login',
  '/api/v1/auth/badge/login',
  '/api/v1/auth/google/login',
  '/api/v1/auth/email/forgot-password',
  '/api/v1/auth/email/reset-password',
  '/api/v1/auth/email/verify',
  AUTH_REFRESH_PATH,
]);

const SIGN_IN_ROUTE = /^\/(login|forgot-password|reset-password)(?:[/?#]|$)/;

/** Sends the user to sign in once per ended session, however many requests were rejected. */
@Injectable({ providedIn: 'root' })
export class SessionExpiryRedirect {
  private readonly router = inject(Router);
  private handled: string | null = null;

  /** `token`: the access token whose session ended. */
  signIn(token: string): void {
    if (this.handled === token) return;
    this.handled = token;
    const redirectUrl = this.router.url;
    if (!SIGN_IN_ROUTE.test(redirectUrl)) {
      void this.router.navigate(['/login'], { queryParams: { [REDIRECT_URL_QUERY_PARAM]: redirectUrl } });
    }
  }
}

/**
 * Adds the session's access token to same-origin API calls. When the API answers 401, the session
 * is renewed once (concurrent failures share one renewal) and the request is sent again once.
 * If the renewal is refused, the user is signed out and sent to sign in, returning afterwards.
 */
export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(AuthSessionService);
  const accessToken = session.accessToken;
  if (!accessToken) return next(req);

  const url = new URL(req.url, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/') || publicAuthPaths.has(url.pathname)) {
    return next(req);
  }
  // A caller that supplies its own credential owns its failures.
  if (req.headers.has('Authorization')) return next(req);
  const expiry = inject(SessionExpiryRedirect);

  const endSession = (token: string) => {
    if (session.accessToken === token) session.logout();
    if (!session.accessToken) expiry.signIn(token);
  };

  const send = (token: string, retried: boolean): Observable<HttpEvent<unknown>> =>
    next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(
      catchError((error: unknown) => {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401) return throwError(() => error);
        const current = session.accessToken;
        if (current !== token) {
          // Renewed by a concurrent request (or another tab) meanwhile: use the new token.
          // A failure from before a sign-in or sign-out is only reported.
          return !retried && current && session.wasRenewed(token) ? send(current, true) : throwError(() => error);
        }
        if (retried) {
          endSession(token);
          return throwError(() => error);
        }
        return session.refreshSession().pipe(
          catchError((refreshError: unknown) => {
            if (refreshError instanceof SessionRefreshRejectedError || !session.accessToken) endSession(token);
            return throwError(() => error);
          }),
          switchMap((renewed) => send(renewed, true)),
        );
      }),
    );

  return send(accessToken, false);
};
