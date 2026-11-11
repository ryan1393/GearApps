import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { BaseEntity } from '@meshforge/shared/domain';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api-config';

/**
 * Typed HTTP client for one REST resource exposed by the API's CRUD controllers.
 * Subclasses add resource-specific calls.
 */
export abstract class CrudApi<T extends BaseEntity, C = Omit<T, 'id'>, U = Partial<C>> {
  protected readonly http = inject(HttpClient);
  protected readonly url: string;

  protected constructor(resource: string) {
    this.url = `${inject(API_BASE_URL)}/${resource}`;
  }

  list(): Observable<T[]> {
    return this.http.get<T[]>(this.url);
  }

  get(id: string): Observable<T> {
    return this.http.get<T>(`${this.url}/${id}`);
  }

  create(body: C): Observable<T> {
    return this.http.post<T>(this.url, body);
  }

  update(id: string, body: U): Observable<T> {
    return this.http.patch<T>(`${this.url}/${id}`, body);
  }

  replace(id: string, body: T): Observable<T> {
    return this.http.put<T>(`${this.url}/${id}`, body);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
