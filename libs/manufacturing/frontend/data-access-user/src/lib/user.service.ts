import { Observable } from 'rxjs';

import { inject, Injectable } from '@angular/core';
import {
  ITokenResponse,
  IUpdateUser,
  IUser,
  IUserLogin,
} from '@gearapps/manufacturing/shared/util-types';

import { AuthSessionService } from './auth-session.service';
import { UserApiService } from './user-api.service';

/** Compatibility facade. New code should inject AuthSessionService or UserApiService directly. */
@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly session = inject(AuthSessionService);
  private readonly users = inject(UserApiService);

  readonly authState$ = this.session.authState$;
  readonly isLoggedIn$ = this.session.isLoggedIn$;

  get accessToken() { return this.session.accessToken; }
  set accessToken(value) { this.session.accessToken = value; }
  get refreshToken() { return this.session.refreshToken; }
  set refreshToken(value) { this.session.refreshToken = value; }
  get tokenExpired() { return this.session.tokenExpired; }

  loginUser(dto: IUserLogin): Observable<ITokenResponse> { return this.session.login(dto); }
  logoutUser(): void { this.session.logout(); }
  editUser(userId: string, user: IUpdateUser): Observable<IUser> { return this.users.update(userId, user); }
}
