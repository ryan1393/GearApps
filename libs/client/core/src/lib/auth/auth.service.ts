import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { AccessTokenPayload, LoginPayload, TokenResponse } from '@gearapps/shared/domain';
import { jwtDecode } from 'jwt-decode';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from '../api/api-config';

const TOKEN_KEY = 'gearapps.token';
/** Treat tokens as expired this many seconds early so in-flight requests don't 401. */
const EXPIRY_GRACE_S = 30;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/auth`;

  private readonly _token = signal<string | null>(readStoredToken());

  /** Raw bearer token, used by the interceptor. */
  readonly token = this._token.asReadonly();
  /** Decoded claims, or null when logged out / token malformed. */
  readonly user = computed<AccessTokenPayload | null>(() => decode(this._token()));
  readonly isAuthenticated = computed(() => {
    const exp = this.user()?.exp;
    return !!exp && exp * 1000 - Date.now() > EXPIRY_GRACE_S * 1000;
  });
  readonly displayName = computed(() => {
    const u = this.user();
    if (!u) return '';
    const name = [u.fname, u.lname].filter(Boolean).join(' ');
    return name || u.email;
  });
  readonly userId = computed(() => this.user()?.sub ?? null);

  capabilities(): Observable<{ registrationEnabled: boolean }> {
    return this.http.get<{ registrationEnabled: boolean }>(`${this.url}/capabilities`);
  }

  login(payload: LoginPayload): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(`${this.url}/login`, payload)
      .pipe(tap(({ access_token }) => this.setToken(access_token)));
  }

  logout(): void {
    this.setToken(null);
  }

  private setToken(token: string | null) {
    this._token.set(token);
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable (private mode) — keep in memory only */
    }
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function decode(token: string | null): AccessTokenPayload | null {
  if (!token) return null;
  try {
    return jwtDecode<AccessTokenPayload>(token);
  } catch {
    return null;
  }
}
