/**
 * What each kind of station may do. Pure: no Nest, no database, so it is tested directly.
 *
 *   GUARD       every guard route (unchanged)
 *   DOCK        dock handheld (CK65): only the routes below — default deny
 *   MANAGEMENT  any read; no changes
 *   DISPLAY     any read; no changes (TV boards, unchanged)
 *
 * Administrator sign-in routes stay reachable from every station except TV displays,
 * so an administrator can sign in on a dock handheld or management PC. A signed-in
 * administrator then overrides these limits (checked by the guard, not here).
 */
import { StationKinds, type StationKind } from '@truck-log/shared/contracts';

export type StationRoleDecision = 'ALLOW' | 'READ_ONLY' | 'ROLE';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ID = '\\d+';

/**
 * Dock work: the Dock Board (Dock Complete, delivery numbers, packing slips) and
 * Records & Paperwork (search, open a visit, open and add paperwork). Paths are
 * relative to /api/v1. Guard-only actions — check-in, Final Checkout, slips and
 * driver print jobs, reference data, settings, RXO controls — are not listed.
 */
const DOCK_ROUTES: ReadonlyArray<readonly [method: string, pattern: RegExp]> = [
  ['GET', new RegExp(`^/visits/dock-board$`)],
  ['GET', new RegExp(`^/visits/history$`)],
  ['GET', new RegExp(`^/visits/${ID}$`)],
  ['GET', new RegExp(`^/visits/${ID}/driver-print-package$`)],
  ['GET', new RegExp(`^/visits/documents/${ID}/download$`)],
  ['GET', new RegExp(`^/settings/dock-aging$`)],
  ['PATCH', new RegExp(`^/visits/${ID}/dock-complete$`)],
  ['POST', new RegExp(`^/visits/${ID}/delivery-number/(?:scan|manual)$`)],
  ['POST', new RegExp(`^/visits/${ID}/packing-slip(?:/scan(?:/preview|/attach)?)?$`)],
  ['POST', new RegExp(`^/visits/${ID}/documents$`)],
];

/** `/api/v1/visits/12/` → `/visits/12`: the global prefix, trailing slash and query are not part of the match. */
export function apiRoute(path: string): string {
  const withoutQuery = (path || '/').split('?')[0];
  const relative = withoutQuery.replace(/^\/api\/v1(?=\/|$)/, '') || '/';
  return relative.length > 1 ? relative.replace(/\/+$/, '') : relative;
}

export function stationRoleDecision(kind: StationKind, method: string, path: string): StationRoleDecision {
  const verb = (method || '').toUpperCase();
  const route = apiRoute(path);
  const reading = READ_METHODS.has(verb);
  const adminSignIn = /^\/admin-auth(?:\/|$)/.test(route);

  switch (kind) {
    case StationKinds.GUARD:
      return 'ALLOW';
    case StationKinds.DISPLAY:
      return reading ? 'ALLOW' : 'READ_ONLY';
    case StationKinds.MANAGEMENT:
      return reading || adminSignIn ? 'ALLOW' : 'READ_ONLY';
    case StationKinds.DOCK:
      if (adminSignIn || verb === 'OPTIONS') return 'ALLOW';
      {
        // HEAD is answered like GET, so it follows the GET list.
        const asListed = verb === 'HEAD' ? 'GET' : verb;
        return DOCK_ROUTES.some(([m, pattern]) => m === asListed && pattern.test(route)) ? 'ALLOW' : 'ROLE';
      }
    default:
      // An unknown kind (newer database, older server) gets no access.
      return 'ROLE';
  }
}
