import { HttpErrorResponse } from '@angular/common/http';

/** Human-readable message from an API error response (class-validator arrays included). */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string | string[] } | null;
    if (body?.message) return Array.isArray(body.message) ? body.message.join('. ') : body.message;
    if (err.status === 0) return 'Cannot reach the server';
    return err.statusText || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
