import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthSessionService } from '@gearapps/manufacturing/frontend/data-access-user';

import { REDIRECT_URL_QUERY_PARAM } from '../constants';

export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(AuthSessionService);
  const router = inject(Router);

  return session.tokenExpired
    ? router.createUrlTree(['/login'], {
        queryParams: { [REDIRECT_URL_QUERY_PARAM]: state.url },
      })
    : true;
};
