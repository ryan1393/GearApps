import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthSessionService } from '@gearapps/manufacturing/frontend/data-access-user';
import {
  canEditGearApp,
  GearAppKey,
} from '@gearapps/manufacturing/shared/util-constants';

const dashboardRoutes: Record<GearAppKey, string> = {
  BLADE_TRACKING: '/blades',
  CUTTER_BUILDER: '/cutter-builder',
  GREENSHED: '/greenshed',
};

/**
 * Cross-department users can reach the app dashboard, but operational pages
 * redirect back to the dashboard unless their department owns that app.
 * Admin role always passes.
 */
export function departmentEditorGuard(app: GearAppKey): CanActivateFn {
  return () => {
    const session = inject(AuthSessionService);
    const router = inject(Router);
    const user = session.currentUser;

    if (!user) {
      return router.createUrlTree(['/login']);
    }

    return canEditGearApp(app, user.role, user.departmentCode)
      ? true
      : router.createUrlTree([dashboardRoutes[app]], {
          queryParams: { viewOnly: '1' },
        });
  };
}

export const adminRoleGuard: CanActivateFn = () => {
  const session = inject(AuthSessionService);
  const router = inject(Router);
  return String(session.currentUser?.role ?? '').toLowerCase() === 'admin'
    ? true
    : router.createUrlTree(['/']);
};
