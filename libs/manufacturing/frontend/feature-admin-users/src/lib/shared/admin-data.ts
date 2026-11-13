import { HttpErrorResponse } from '@angular/common/http';
import { Loadable } from '@meshforge/client/core';
import { EMPTY, expand, Observable, reduce } from 'rxjs';

import { adminApiErrorText, PagedResponse } from '../admin-api.service';

/** Upper bound on pages read for one list; a server that never reports the last page cannot spin forever. */
const MAX_PAGES = 500;

/**
 * Every page of a paged Admin list, read one after another and emitted once as one array.
 * Cancelling the subscription stops the remaining pages.
 */
export function allPages<T>(fetchPage: (page: number) => Observable<PagedResponse<T>>): Observable<T[]> {
  return fetchPage(1).pipe(
    expand((response, index) => (response.meta?.hasNextPage && index + 2 <= MAX_PAGES ? fetchPage(index + 2) : EMPTY)),
    reduce<PagedResponse<T>, T[]>((rows, response) => rows.concat(response.data ?? []), []),
  );
}

/** What went wrong loading a list, in the words the API used where it gave any. */
export function loadErrorText(error: unknown): string {
  return error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'Request failed.';
}

/** The lists among `lists` that failed to load, by name, for one "could not load" notice. */
export function failedLists(lists: Record<string, Loadable<unknown>>): string[] {
  return Object.entries(lists).filter(([, list]) => list.error() !== null).map(([name]) => name);
}

/** Case-insensitive search across the given values; a blank search matches everything. */
export function adminSearchMatches(searchText: string, values: unknown[]): boolean {
  const search = searchText.trim().toUpperCase();
  if (!search) return true;
  return values
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .join(' ')
    .toUpperCase()
    .includes(search);
}

/** A confirmation an administrator answers in the page before a disruptive change is sent. */
export interface AdminConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** Runs only when the administrator confirms. */
  run: () => void;
}

/** One pending confirmation at a time, shown with `<dana-confirm-dialog>`. */
export class AdminConfirmation {
  request: AdminConfirmRequest | null = null;

  ask(request: AdminConfirmRequest): void { this.request = request; }

  accept(): void {
    const request = this.request;
    this.request = null;
    request?.run();
  }

  dismiss(): void { this.request = null; }
}
