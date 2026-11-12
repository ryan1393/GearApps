import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { catchError, map, of } from 'rxjs';

import { REDIRECT_URL_QUERY_PARAM } from '../constants';

/** Pages for signed-in users. An expired access token is renewed first; sign-in is the fallback. */
export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(AuthSessionService);
  const router = inject(Router);
  const signIn = () => router.createUrlTree(['/login'], {
    queryParams: { [REDIRECT_URL_QUERY_PARAM]: state.url },
  });
  if (!session.tokenExpired) return true;
  if (!session.refreshToken) return signIn();
  return session.refreshSession().pipe(
    map((): boolean | UrlTree => (session.tokenExpired ? signIn() : true)),
    catchError(() => of(signIn())),
  );
};

/**
 * The sign-in page. A user who is already signed in (or whose session can be renewed)
 * goes to the page they asked for, or to the app's home page.
 */
export const signedOutGuard: CanActivateFn = (route) => {
  const session = inject(AuthSessionService);
  const router = inject(Router);
  const home = (): UrlTree => {
    const requested = route.queryParamMap.get(REDIRECT_URL_QUERY_PARAM);
    // Only a path inside this app; never a sign-in page (which would loop) or another site.
    if (requested && requested.startsWith('/') && !requested.startsWith('//') && !/^\/login(?:[/?#]|$)/.test(requested)) {
      try { return router.parseUrl(requested); } catch { /* fall back to home */ }
    }
    return router.createUrlTree(['/']);
  };
  if (!session.tokenExpired) return home();
  if (!session.refreshToken) return true;
  return session.refreshSession().pipe(
    map((): boolean | UrlTree => (session.tokenExpired ? true : home())),
    catchError(() => of(true)),
  );
};
