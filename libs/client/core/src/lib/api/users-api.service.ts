import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CreateUser, PublicUser } from '@gearapps/shared/domain';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api-config';

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/users`;

  register(body: CreateUser): Observable<PublicUser> {
    return this.http.post<PublicUser>(this.url, body);
  }

  me(): Observable<PublicUser> {
    return this.http.get<PublicUser>(`${this.url}/me`);
  }
}
