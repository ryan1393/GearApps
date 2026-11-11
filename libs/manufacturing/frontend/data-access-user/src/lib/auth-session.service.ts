import { jwtDecode } from 'jwt-decode';
import { BehaviorSubject, map, Observable, tap } from 'rxjs';

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  AccessToken,
  IJwtPayload,
  ITokenResponse,
  IUserLogin,
  RefreshToken,
} from '@meshforge/manufacturing/shared/util-types';

import {
  LOCAL_STORAGE_KEY_ACCESS_TOKEN,
  LOCAL_STORAGE_KEY_REFRESH_TOKEN,
} from './constants';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly http = inject(HttpClient);
  private readonly userDataSubject = new BehaviorSubject<IJwtPayload | null>(null);
  private _accessToken: AccessToken | null = null;
  private _refreshToken: RefreshToken | null = null;

  readonly authState$ = this.userDataSubject.asObservable();
  readonly isLoggedIn$ = this.authState$.pipe(map(Boolean));

  constructor() {
    this.accessToken = this.readToken(LOCAL_STORAGE_KEY_ACCESS_TOKEN);
    this.refreshToken = this.readToken(LOCAL_STORAGE_KEY_REFRESH_TOKEN);
  }

  get currentUser(): IJwtPayload | null {
    return this.userDataSubject.value;
  }

  get accessToken(): AccessToken | null { return this._accessToken; }
  set accessToken(value: AccessToken | null) {
    this._accessToken = value;
    this.writeToken(LOCAL_STORAGE_KEY_ACCESS_TOKEN, value);
    this.userDataSubject.next(value ? this.decodeAccessToken(value) : null);
  }

  get refreshToken(): RefreshToken | null { return this._refreshToken; }
  set refreshToken(value: RefreshToken | null) {
    this._refreshToken = value;
    this.writeToken(LOCAL_STORAGE_KEY_REFRESH_TOKEN, value);
  }

  get tokenExpired(): boolean {
    const exp = this.userDataSubject.value?.exp;
    return !exp || Date.now() >= exp * 1000;
  }

  login(dto: IUserLogin): Observable<ITokenResponse> {
    return this.http.post<ITokenResponse>('/api/v1/auth/email/login', dto).pipe(
      tap(({ accessToken, refreshToken }) => {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
      }),
    );
  }

  logout(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  private readToken(key: string): string | null {
    const value = localStorage.getItem(key);
    return value && value !== 'null' && value !== 'undefined' ? value : null;
  }

  private writeToken(key: string, value: string | null): void {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }

  private decodeAccessToken(token: string): IJwtPayload | null {
    try {
      return jwtDecode<IJwtPayload>(token);
    } catch {
      localStorage.removeItem(LOCAL_STORAGE_KEY_ACCESS_TOKEN);
      this._accessToken = null;
      return null;
    }
  }
}
