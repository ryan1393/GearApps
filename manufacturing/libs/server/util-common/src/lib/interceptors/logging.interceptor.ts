import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { randomUUID as uuidv4 } from 'node:crypto';

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  HttpException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      return this.logHttpCall(context, next);
    }
    return next.handle();
  }

  private logHttpCall(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const userAgent = request.get('user-agent') || '';
    const { ip, method, path: url } = request;
    const correlationKey = uuidv4();
    const userId = request.user?.userId;

    this.logger.log(
      `[${correlationKey}] ${method} ${url} ${userId} ${userAgent} ${ip}: ${
        context.getClass().name
      } ${context.getHandler().name}`,
    );

    const now = Date.now();
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();

        const { statusCode } = response;
        const contentLength = response.get('content-length');

        this.logger.log(
          `[${correlationKey}] ${method} ${url} ${statusCode} ${contentLength}: ${
            Date.now() - now
          }ms`,
        );
      }),
      catchError((error: unknown) => {
        const elapsed = Date.now() - now;
        if (error instanceof HttpException) {
          const httpError = error as HttpException;
          const response = httpError.getResponse();
          const responseText =
            typeof response === 'string' ? response : JSON.stringify(response);
          this.logger.error(
            `[${correlationKey}] ${method} ${url} HTTP ${httpError.getStatus()} after ${elapsed}ms: ${responseText}`,
          );
        } else if (error instanceof Error) {
          this.logger.error(
            `[${correlationKey}] ${method} ${url} FAILED after ${elapsed}ms: ${error.message}`,
            error.stack,
          );
        } else {
          this.logger.error(
            `[${correlationKey}] ${method} ${url} FAILED after ${elapsed}ms: ${String(error)}`,
          );
        }
        throw error;
      }),
    );
  }
}
