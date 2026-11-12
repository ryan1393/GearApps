import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

export type ServerErrorReporter = (exception: unknown) => void;

let reporter: ServerErrorReporter | null = null;

/** Set once by the API entry point (for example to Sentry); null turns reporting off. */
export function setServerErrorReporter(next: ServerErrorReporter | null): void {
  reporter = next;
}

/** Hands a server-side failure to the configured reporter. Reporting never changes a response. */
export function reportServerError(exception: unknown): void {
  try {
    reporter?.(exception);
  } catch {
    // A failing reporter must not turn into a second error for the client.
  }
}

/**
 * Reports every exception that becomes a 5xx response, then answers exactly as Nest's default
 * handler would. Register it before the more specific filters (EntityNotFound, QueryFailed):
 * Nest tries the last registered global filter first, so they keep handling their own errors.
 */
@Catch()
export class ReportServerErrorsFilter extends BaseExceptionFilter {
  public override catch(exception: unknown, host: ArgumentsHost) {
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) reportServerError(exception);
    super.catch(exception, host);
  }
}
