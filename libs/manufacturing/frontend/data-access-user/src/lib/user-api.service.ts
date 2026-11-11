import { Observable } from 'rxjs';

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  IPaginatedResponse,
  IUpdateUser,
  IUser,
} from '@meshforge/manufacturing/shared/util-types';

@Injectable({ providedIn: 'root' })
export class UserApiService {
  private readonly http = inject(HttpClient);

  list(perPage = 50): Observable<IPaginatedResponse<IUser>> {
    return this.http.get<IPaginatedResponse<IUser>>(`/api/v1/users?perPage=${perPage}`);
  }

  update(userId: string, user: IUpdateUser): Observable<IUser> {
    return this.http.patch<IUser>(`/api/v1/users/${userId}`, user);
  }
}
