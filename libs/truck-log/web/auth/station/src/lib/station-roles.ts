import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import type { StationKind, TruckLogRole } from '@truck-log/shared/contracts';
import { TruckLogStationAccess } from './station-access.service';

/**
 * Which screens each role sees. The server enforces the same limits on the API
 * (libs/truck-log/server/auth/station/src/lib/station-roles.ts); this only keeps
 * people from opening screens they could not use.
 */
export type TruckLogScreen =
  | 'dashboard' | 'check-in' | 'dock-board' | 'active-trucks' | 'history'
  | 'rxo' | 'rxo-expedite' | 'admin' | 'tv';

const ALL: readonly TruckLogScreen[] = ['dashboard', 'check-in', 'dock-board', 'active-trucks', 'history', 'rxo', 'rxo-expedite', 'admin', 'tv'];

const ROLE_SCREENS: Record<TruckLogRole, readonly TruckLogScreen[]> = {
  ADMIN: ALL,
  GUARD: ALL,
  /** CK65 dock handheld: dock work and paperwork only. */
  DOCK: ['dock-board', 'history'],
  /** View-only: every operational screen; the Administration link leads to sign-in. */
  MANAGEMENT: ['dashboard', 'dock-board', 'active-trucks', 'history', 'rxo', 'rxo-expedite', 'admin', 'tv'],
  DISPLAY: ['tv'],
};

export function roleCanOpen(role: TruckLogRole, screen: TruckLogScreen): boolean {
  return ROLE_SCREENS[role]?.includes(screen) ?? false;
}

/** View-only roles: the server refuses every change, so change buttons are hidden. */
export function roleIsViewOnly(role: TruckLogRole | null): boolean {
  return role === 'MANAGEMENT' || role === 'DISPLAY';
}

/** Where a role starts (also where it lands after a screen it may not open). Always a screen it may open. */
export function roleHome(role: TruckLogRole | StationKind | null | undefined): string {
  if (role === 'DOCK') return '/dock-board';
  if (role === 'DISPLAY') return '/tv/docks';
  return '/';
}

/**
 * Route guard: `data: { screen }` names the screen. A browser whose role may not open it
 * goes to its role's home. While the role is unknown (API unreachable, not yet paired)
 * the page opens: station setup and the server's own checks handle those cases.
 */
export const truckLogRoleGuard: CanActivateFn = (route) => {
  const station = inject(TruckLogStationAccess);
  const router = inject(Router);
  const screen = route.data?.['screen'] as TruckLogScreen | undefined;
  if (!screen) return true;
  const decide = () => {
    const role = station.role();
    return !role || roleCanOpen(role, screen) ? true : router.parseUrl(roleHome(role));
  };
  const known = station.role();
  // Re-read the session before refusing: an administrator may have just signed in.
  if (known && roleCanOpen(known, screen)) return true;
  return known === null && station.state() === 'unavailable' ? of(true) : station.load().pipe(map(decide));
};
