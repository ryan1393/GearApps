/**
 * Station sign-in.
 *
 * Every guard PC, dock handheld, management PC and TV is a "station". An
 * administrator registers it and gets a one-time pairing code; the station enters
 * the code once and receives a long-lived HttpOnly cookie. Every guard API route
 * then requires either a paired station or a signed-in administrator.
 *
 * The station's kind is its role (enforced by the server, mirrored by the web app):
 *
 *   GUARD       full guard workflow (check in, dock board, checkout, uploads)
 *   DOCK        dock handheld (CK65): Dock Board (Dock Complete, delivery numbers,
 *               packing slips) and Records & Paperwork; every other route is refused
 *   MANAGEMENT  view-only: every operational screen, no changes
 *   DISPLAY     read-only (TV boards); any non-GET request is refused
 *
 * A signed-in administrator may do everything on any browser, whatever its kind.
 *
 * HTTP API (all under /api/v1):
 *
 *   Station side (no sign-in needed to call these):
 *     GET  /station-access/session          -> StationSession (200), never 401
 *     POST /station-access/pair  {code}     -> StationSession (200) and sets the cookie
 *                                              400 STATION_CODE_INVALID | 429 STATION_PAIR_RATE_LIMITED
 *     POST /station-access/sign-out         -> 204, clears this browser's cookie
 *
 *   Administrator side (admin session required, including for GET):
 *     GET  /stations                        -> StationRecord[]
 *     POST /stations  {name, kind}          -> StationPairingResult
 *     POST /stations/:id/pairing-code       -> StationPairingResult (signs the station out until re-paired)
 *     POST /stations/:id/revoke             -> StationRecord
 *
 *   Errors on every other guard route:
 *     401 {code: 'STATION_REQUIRED'}   this browser is not a paired station and no admin is signed in
 *     403 {code: 'STATION_READ_ONLY'}  a DISPLAY or MANAGEMENT station tried to change something
 *     403 {code: 'STATION_ROLE'}       a DOCK station used a route outside dock work
 */
export const StationKinds = {
  GUARD: 'GUARD',
  DOCK: 'DOCK',
  MANAGEMENT: 'MANAGEMENT',
  DISPLAY: 'DISPLAY',
} as const;
export type StationKind = (typeof StationKinds)[keyof typeof StationKinds];

/** Every station kind, in the order the Stations screen offers them. */
export const STATION_KIND_LIST: readonly StationKind[] = [StationKinds.GUARD, StationKinds.DOCK, StationKinds.MANAGEMENT, StationKinds.DISPLAY];

export function isStationKind(value: unknown): value is StationKind {
  return typeof value === 'string' && (STATION_KIND_LIST as readonly string[]).includes(value);
}

/** What a browser may do: its station's kind, or ADMIN when an administrator is signed in. */
export type TruckLogRole = StationKind | 'ADMIN';

export const STATION_KIND_LABELS: Record<StationKind, string> = {
  GUARD: 'Guard station',
  DOCK: 'Dock handheld',
  MANAGEMENT: 'Management',
  DISPLAY: 'TV display',
};

export type StationStatus = 'WAITING_FOR_PAIRING' | 'ACTIVE' | 'REVOKED';

export interface StationIdentity {
  id: string;
  name: string;
  kind: StationKind;
}

export interface StationSession {
  /** The paired station this browser belongs to, if any. */
  station: StationIdentity | null;
  /** True when an administrator session also authorizes this browser. */
  admin: boolean;
}

export interface StationRecord extends StationIdentity {
  status: StationStatus;
  createdAt: string;
  createdBy: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  /** Set while a pairing code is outstanding. */
  pairingExpiresAt: string | null;
}

export interface StationPairingResult {
  station: StationRecord;
  /** Shown once, formatted XXXX-XXXX. Never stored in plain text. */
  pairingCode: string;
  pairingExpiresAt: string;
}

export const STATION_PAIRING_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-?[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
export const STATION_NAME_MAX = 80;
