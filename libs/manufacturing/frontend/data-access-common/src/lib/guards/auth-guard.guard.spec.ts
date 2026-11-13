import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';

import { authGuard, signedOutGuard } from './auth-guard.guard';

describe('session guards', () => {
  let session: { tokenExpired: boolean; refreshToken: string | null; refreshSession: jest.Mock };
  let router: Router;

  beforeEach(() => {
    session = { tokenExpired: false, refreshToken: 'refresh', refreshSession: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AuthSessionService, useValue: session }] });
    router = TestBed.inject(Router);
  });

  const resolve = async (result: unknown) =>
    isObservable(result) ? firstValueFrom(result as Observable<unknown>) : result;
  const url = (result: unknown) => (result instanceof UrlTree ? router.serializeUrl(result) : result);
  const runAuth = () => TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url: '/blades/trays' } as RouterStateSnapshot));
  const runSignedOut = (query: Record<string, string> = {}) => TestBed.runInInjectionContext(() =>
    signedOutGuard({ queryParamMap: convertToParamMap(query) } as ActivatedRouteSnapshot, {} as RouterStateSnapshot));

  it('lets a signed-in user through', async () => {
    expect(await resolve(runAuth())).toBe(true);
  });

  it('renews an expired session before opening the page', async () => {
    session.tokenExpired = true;
    session.refreshSession.mockImplementation(() => { session.tokenExpired = false; return of('new-access'); });
    expect(await resolve(runAuth())).toBe(true);
    expect(session.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('sends the user to sign in, returning to the page, when renewal fails', async () => {
    session.tokenExpired = true;
    session.refreshSession.mockReturnValue(throwError(() => new Error('refused')));
    expect(url(await resolve(runAuth()))).toBe('/login?redirectUrl=%2Fblades%2Ftrays');
  });

  it('sends a user without a session straight to sign in', async () => {
    session.tokenExpired = true; session.refreshToken = null;
    expect(url(await resolve(runAuth()))).toBe('/login?redirectUrl=%2Fblades%2Ftrays');
    expect(session.refreshSession).not.toHaveBeenCalled();
  });

  it('sends a signed-in user from the sign-in page to the app home or the requested page', async () => {
    expect(url(await resolve(runSignedOut()))).toBe('/');
    expect(url(await resolve(runSignedOut({ redirectUrl: '/blades/trays?tab=2' })))).toBe('/blades/trays?tab=2');
    expect(url(await resolve(runSignedOut({ redirectUrl: '//elsewhere.example' })))).toBe('/');
    expect(url(await resolve(runSignedOut({ redirectUrl: '/login' })))).toBe('/');
  });

  it('shows the sign-in page when there is no session to renew', async () => {
    session.tokenExpired = true; session.refreshToken = null;
    expect(await resolve(runSignedOut())).toBe(true);
    session.refreshToken = 'refresh';
    session.refreshSession.mockReturnValue(throwError(() => new Error('refused')));
    expect(await resolve(runSignedOut())).toBe(true);
  });
});
