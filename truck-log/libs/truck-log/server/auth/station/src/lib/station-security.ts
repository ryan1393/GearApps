/**
 * Station sign-in primitives. Pure functions: no Nest, no database.
 * Only SHA-256 digests of pairing codes and station tokens are ever stored.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { STATION_NAME_MAX, STATION_PAIRING_CODE_PATTERN, StationKinds } from '@truck-log/shared/contracts';
import type { StationKind } from '@truck-log/shared/contracts';

/** No 0/O, 1/I/L: codes are read aloud and typed on guard PCs. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_MINUTES = 30;
/** Browsers cap cookie lifetime at 400 days. Re-pair a station to renew. */
export const STATION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 3600;

export class StationFault extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'StationFault';
  }
}
export function stationFail(status: number, code: string, message: string): never {
  throw new StationFault(status, code, message);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A new pairing code, formatted XXXX-XXXX. */
export function newPairingCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += PAIRING_ALPHABET[random(PAIRING_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalize what a person typed: case, spaces and the dash do not matter. Returns null when it cannot be a code. */
export function normalizePairingCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return STATION_PAIRING_CODE_PATTERN.test(code) ? code : null;
}

export function pairingCodeDigest(normalizedCode: string): string {
  return sha256(`truck-log-station-pairing\n${normalizedCode}`);
}

export function newStationToken(): string {
  return randomBytes(32).toString('hex');
}

export function stationTokenDigest(token: string): string {
  return sha256(`truck-log-station-token\n${token}`);
}

export function stationName(input: unknown): string {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > STATION_NAME_MAX || /[\x00-\x1f\x7f]/.test(name)) {
    stationFail(400, 'STATION_NAME', `Station name is required (1–${STATION_NAME_MAX} characters).`);
  }
  return name;
}

export function stationKind(input: unknown): StationKind {
  if (input === StationKinds.GUARD || input === StationKinds.DISPLAY) return input;
  return stationFail(400, 'STATION_KIND', 'Station type must be GUARD or DISPLAY.');
}

/** Cookie settings follow the admin transport: Secure + __Host- prefix unless explicitly running internal HTTP. */
export function cookieSettings(env: Record<string, string | undefined>): { name: string; secure: boolean } {
  const secure = env.TRUCK_LOG_ADMIN_TRANSPORT !== 'internal-http';
  return { name: secure ? '__Host-TruckLogStation' : 'TruckLogStation', secure };
}

export function stationCookie(token: string, settings: { name: string; secure: boolean }): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid station token encoding');
  return `${settings.name}=${token}; Path=/;${settings.secure ? ' Secure;' : ''} HttpOnly; SameSite=Strict; Max-Age=${STATION_COOKIE_MAX_AGE_SECONDS}`;
}

export function clearStationCookie(settings: { name: string; secure: boolean }): string {
  return `${settings.name}=; Path=/;${settings.secure ? ' Secure;' : ''} HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** The station token from a Cookie header, or null. Duplicate cookies are refused rather than guessed. */
export function stationTokenFromCookie(raw: unknown, settings: { name: string }): string | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  const values = raw.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${settings.name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(settings.name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

/**
 * Cross-site request check for cookie-authenticated changes. SameSite=Strict already
 * keeps the cookie off cross-site requests; this refuses any request whose Origin
 * is not one of the configured Truck Log addresses.
 */
export function allowedOrigins(env: Record<string, string | undefined>): Set<string> {
  const values = [env.TRUCK_LOG_PUBLIC_ORIGIN, env.TRUCK_LOG_ADMIN_ORIGIN, ...(env.TRUCK_LOG_CORS_ORIGINS || '').split(',')];
  const origins = new Set<string>();
  for (const value of values) {
    try { if (value && value.trim()) origins.add(new URL(value.trim()).origin); } catch { /* ignore malformed entries */ }
  }
  return origins;
}

export function originAllowed(headers: Record<string, string | string[] | undefined>, origins: Set<string>): boolean {
  const fetchSite = typeof headers['sec-fetch-site'] === 'string' ? headers['sec-fetch-site'] : '';
  // Modern browsers say exactly where a request came from. same-site (another port or
  // subdomain on the same host) is refused: SameSite cookies would still be sent.
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = typeof headers.origin === 'string' ? headers.origin : '';
  if (!origin || origins.has(origin)) return true;
  // Older browsers: same-origin when the Origin names the host the request was sent to
  // (nginx forwards Host), so guard PCs may use the server's name or its IP address.
  try {
    const host = typeof headers.host === 'string' ? headers.host.toLowerCase() : '';
    const url = new URL(origin);
    return !!host && (url.host.toLowerCase() === host || url.hostname.toLowerCase() === host);
  } catch { return false; }
}

/** Small in-memory sliding-window limiter for pairing attempts. */
export class AttemptLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}
  /** Records an attempt; returns false when the key is over its limit. */
  attempt(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

/**
 * Local development only (`nx serve`): skip station sign-in. Honoured only when
 * NODE_ENV=development, which the Docker image never sets (Compose forces production).
 */
export function developmentOpenAccess(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'development' && env.TRUCK_LOG_DEV_OPEN_STATIONS === 'true';
}
