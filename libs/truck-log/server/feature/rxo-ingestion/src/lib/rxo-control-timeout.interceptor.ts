import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

const RXO_CONTROL_STATUS_TIMEOUT_MS = 8000;

/**
 * TRUCK LOG RXO CONTROL
 *
 * Bounds ONLY the GET /api/v1/rxo/control status request.
 * It does not alter RXO acquisition, scan execution, PostgreSQL ingestion,
 * Run Scan Now, Sync Current Export, credentials, or exporter behavior.
 *
 * If the remote Docker/control channel cannot answer promptly, Truck Log
 * returns a normal 503 degraded-control response instead of leaving the
 * Control Center request hanging.
 */
@Injectable()
export class RxoControlStatusTimeoutInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(RXO_CONTROL_STATUS_TIMEOUT_MS),
      catchError((error: unknown) => {
        const name =
          typeof error === 'object' && error !== null && 'name' in error
            ? String((error as { name?: unknown }).name ?? '')
            : '';

        if (name === 'TimeoutError') {
          return throwError(
            () =>
              new ServiceUnavailableException({
                code: 'RXO_REMOTE_CONTROL_TIMEOUT',
                message:
                  'Remote RXO controls are temporarily unavailable. PostgreSQL RXO data remains available.',
                degraded: true,
                timeoutMs: RXO_CONTROL_STATUS_TIMEOUT_MS,
              }),
          );
        }

        return throwError(() => error);
      }),
    );
  }
}