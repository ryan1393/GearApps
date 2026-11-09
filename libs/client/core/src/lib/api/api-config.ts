import { InjectionToken } from '@angular/core';

/** Base URL of the Lapper API. Defaults to the same-origin reverse-proxy path. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api/v1',
});
