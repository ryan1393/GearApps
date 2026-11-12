import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap, throwError, timeout } from 'rxjs';
import {
  STATION_KIND_LABELS,
  STATION_NAME_MAX,
  STATION_PAIRING_CODE_PATTERN,
  isStationKind,
  type StationIdentity,
  type StationKind,
  type StationPairingResult,
  type StationRecord,
  type StationSession,
  type TruckLogRole,
} from '@truck-log/shared/contracts';
import { ToastService } from '@truck-log/web/ui';

const API = '/api/v1';
const STATION_ACCESS = `${API}/station-access`;
const STATIONS = `${API}/stations`;
export const STATION_SETUP_PATH = '/station/setup';
/** Pages that must stay reachable from a browser that is not a paired station. */
const PUBLIC_PATHS = [STATION_SETUP_PATH, '/admin/login'];

/** Uppercase, drop spaces and dashes, then present as XXXX-XXXX when 8 characters long. */
export function normalizePairingCode(raw: string | null | undefined): string {
  const compact = String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '');
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

export function isValidPairingCode(code: string): boolean {
  return STATION_PAIRING_CODE_PATTERN.test(normalizePairingCode(code));
}

function pathOf(value: string): string {
  return value.split(/[?#]/)[0];
}

export function isStationPublicPath(url: string): boolean {
  const pathname = pathOf(url);
  return PUBLIC_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(publicPath + '/'));
}

/**
 * Only same-app paths are accepted as a return address: a single leading
 * slash, no scheme or protocol-relative host, and never one of the public
 * sign-in pages (which would loop). Anything else returns '/'.
 */
export function safeStationReturn(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[\u0000-\u001f]/.test(candidate)) return '/';
  try {
    const base = 'http://truck-log.invalid';
    const url = new URL(candidate, base);
    if (url.origin !== base) return '/';
    const result = url.pathname + url.search + url.hash;
    if (isStationPublicPath(result)) return '/';
    return result;
  } catch {
    return '/';
  }
}

export function isStationSession(value: unknown): value is StationSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<StationSession>;
  if (typeof session.admin !== 'boolean') return false;
  if (session.station === null) return true;
  return isStationIdentity(session.station);
}

function isStationIdentity(value: unknown): value is StationIdentity {
  if (!value || typeof value !== 'object') return false;
  const station = value as Partial<StationIdentity>;
  return typeof station.id === 'string'
    && typeof station.name === 'string'
    && isStationKind(station.kind);
}

export function stationKindLabel(kind: StationKind | string | null | undefined): string {
  return isStationKind(kind) ? STATION_KIND_LABELS[kind] : 'Guard station';
}

/** Operator-facing text for station-access error responses. */
export function stationErrorMessage(error: unknown, fallback: string): string {
  const response = error as { status?: number; error?: { code?: string; message?: unknown } } | undefined;
  const code = response?.error?.code;
  if (code === 'STATION_CODE_INVALID') return 'That code is wrong or has expired. Ask an administrator for a new one.';
  if (code === 'STATION_PAIR_RATE_LIMITED' || response?.status === 429) return 'Too many attempts from this station. Wait a minute, then try again.';
  if (code === 'ADMIN_SESSION_REQUIRED') return 'Your administrator session has ended. Sign in again.';
  if (response?.status === 0) return 'Truck Log could not be reached. Check the network connection and try again.';
  const message = response?.error?.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message) && message.length) return message.join(' ');
  return fallback;
}

export type StationSessionState = 'loading' | 'ready' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class TruckLogStationAccess {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private lastReadOnlyNotice = 0;

  /** The station session for this browser; null until loaded or when the API is unavailable. */
  readonly session = signal<StationSession | null>(null);
  readonly state = signal<StationSessionState>('loading');
  /**
   * What this browser may do: ADMIN while an administrator is signed in, otherwise the paired
   * station's kind; null while unknown (loading, unreachable API, or not paired yet).
   */
  readonly role = computed<TruckLogRole | null>(() => {
    const session = this.session();
    if (!session) return null;
    if (session.admin) return 'ADMIN';
    return session.station?.kind ?? null;
  });

  /** GET /station-access/session. Never errors: an unreachable API leaves state 'unavailable'. */
  load(): Observable<StationSession | null> {
    this.state.set(this.session() ? 'ready' : 'loading');
    return this.http.get<StationSession>(`${STATION_ACCESS}/session`).pipe(
      timeout(10000),
      map((value) => {
        if (!isStationSession(value)) throw new Error('Invalid station session response');
        return value;
      }),
      tap((value) => { this.session.set(value); this.state.set('ready'); }),
      catchError(() => { this.state.set('unavailable'); return of(null); }),
    );
  }

  /** True once the session is known and neither a station nor an administrator authorizes this browser. */
  needsSetup(): boolean {
    const session = this.session();
    return this.state() === 'ready' && !!session && !session.station && !session.admin;
  }

  pair(code: string): Observable<StationSession> {
    const normalized = normalizePairingCode(code);
    if (!STATION_PAIRING_CODE_PATTERN.test(normalized)) {
      return throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'STATION_CODE_INVALID' } }));
    }
    return this.http.post<StationSession>(`${STATION_ACCESS}/pair`, { code: normalized }).pipe(
      timeout(20000),
      map((value) => {
        if (!isStationSession(value)) throw new Error('Invalid station session response');
        return value;
      }),
      tap((value) => { this.session.set(value); this.state.set('ready'); }),
    );
  }

  signOut(): Observable<unknown> {
    return this.http.post(`${STATION_ACCESS}/sign-out`, {}).pipe(
      timeout(10000),
      tap(() => this.session.set({ station: null, admin: this.session()?.admin ?? false })),
    );
  }

  // ---- administrator side (admin session required; mutations go through truckLogAdminInterceptor) ----
  stations(): Observable<StationRecord[]> {
    return this.http.get<StationRecord[]>(STATIONS).pipe(timeout(10000), map((rows) => Array.isArray(rows) ? rows : []));
  }

  createStation(name: string, kind: StationKind): Observable<StationPairingResult> {
    const trimmed = name.trim().slice(0, STATION_NAME_MAX);
    return this.http.post<StationPairingResult>(STATIONS, { name: trimmed, kind }).pipe(timeout(20000));
  }

  newPairingCode(id: string): Observable<StationPairingResult> {
    return this.http.post<StationPairingResult>(`${STATIONS}/${encodeURIComponent(id)}/pairing-code`, {}).pipe(timeout(20000));
  }

  revoke(id: string): Observable<StationRecord> {
    return this.http.post<StationRecord>(`${STATIONS}/${encodeURIComponent(id)}/revoke`, {}).pipe(timeout(20000));
  }

  // ---- interceptor hooks ----
  /** Send this browser to station setup, remembering where it was. Never loops from a public page. */
  redirectToSetup(currentUrl = currentBrowserUrl()) {
    if (isStationPublicPath(currentUrl) || isStationPublicPath(this.router.url)) return;
    this.session.set({ station: null, admin: false });
    this.state.set('ready');
    const returnTo = safeStationReturn(currentUrl);
    void this.router.navigate([STATION_SETUP_PATH], { queryParams: returnTo === '/' ? {} : { returnTo } });
  }

  notifyReadOnly() {
    const now = Date.now();
    if (now - this.lastReadOnlyNotice < 10000) return;
    this.lastReadOnlyNotice = now;
    if (this.role() === 'MANAGEMENT') this.toast.warning('Management stations can view everything but not change it.', 'View-only station');
    else this.toast.warning('This is a display-only station.', 'Read-only station');
  }

  notifyRoleLimit() {
    const now = Date.now();
    if (now - this.lastReadOnlyNotice < 10000) return;
    this.lastReadOnlyNotice = now;
    this.toast.warning('This dock handheld can only use the Dock Board and Records & Paperwork.', 'Dock handheld');
  }
}

function currentBrowserUrl(): string {
  if (typeof location === 'undefined') return '/';
  return location.pathname + location.search + location.hash;
}

function isTruckLogApi(url: string): boolean {
  if (typeof location === 'undefined') return url.startsWith(API + '/');
  try {
    const parsed = new URL(url, location.origin);
    return parsed.origin === location.origin && parsed.pathname.startsWith(API + '/');
  } catch {
    return false;
  }
}

/**
 * 401 STATION_REQUIRED -> /station/setup?returnTo=<current page>;
 * 403 STATION_READ_ONLY -> display-only / view-only toast; 403 STATION_ROLE -> dock handheld toast.
 * The error is always re-thrown so the calling page still settles its busy state.
 */
export const truckLogStationInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isTruckLogApi(req.url)) return next(req);
  const station = inject(TruckLogStationAccess);
  return next(req).pipe(catchError((error: HttpErrorResponse) => {
    const code = error?.error?.code;
    if (error?.status === 401 && code === 'STATION_REQUIRED') station.redirectToSetup();
    else if (error?.status === 403 && code === 'STATION_READ_ONLY') station.notifyReadOnly();
    else if (error?.status === 403 && code === 'STATION_ROLE') station.notifyRoleLimit();
    return throwError(() => error);
  }));
};
