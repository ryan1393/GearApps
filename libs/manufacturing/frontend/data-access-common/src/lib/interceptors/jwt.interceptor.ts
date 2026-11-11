import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { catchError, throwError } from 'rxjs';
import { REDIRECT_URL_QUERY_PARAM } from '../constants';

const publicAuthPaths = new Set([
  '/api/v1/auth/email/login',
  '/api/v1/auth/google/login',
  '/api/v1/auth/email/forgot-password',
  '/api/v1/auth/email/reset-password',
  '/api/v1/auth/email/verify',
]);

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(AuthSessionService);
  const accessToken = session.accessToken;
  if (!accessToken) return next(req);

  const url = new URL(req.url, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/') || publicAuthPaths.has(url.pathname)) {
    return next(req);
  }
  const router = inject(Router);
  const authorization = `Bearer ${accessToken}`;
  const request = req.headers.has('Authorization') ? req : req.clone({
    setHeaders: { Authorization: authorization },
  });
  return next(request).pipe(catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse && error.status === 401 &&
      request.headers.get('Authorization') === authorization && session.accessToken === accessToken) {
      // Ignore late failures from a previous sign-in and avoid repeated dashboard redirects.
      session.logout();
      const redirectUrl = router.url;
      if (!/^\/(login|forgot-password|reset-password)(?:[/?#]|$)/.test(redirectUrl)) {
        void router.navigate(['/login'], { queryParams: { [REDIRECT_URL_QUERY_PARAM]: redirectUrl } });
      }
    }
    return throwError(() => error);
  }));
};
