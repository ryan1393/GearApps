import { Response } from 'express';
import { STATUS_CODES } from 'http';
import { QueryFailedError } from 'typeorm';

import { ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter, Reflector } from '@nestjs/core';

export function isQueryFailedError(
  thrownValue: unknown,
): thrownValue is QueryFailedError {
  return thrownValue instanceof QueryFailedError;
}

@Catch(QueryFailedError)
export class QueryFailedFilter extends BaseExceptionFilter {
  constructor(public reflector: Reflector) {
    super();
  }

  public override catch(
    exception: QueryFailedError & { constraint?: string },
    host: ArgumentsHost,
  ) {
    const driverError = exception.driverError as {
      code?: string;
      constraint?: string;
    };
    const code = typeof driverError?.code === 'string' ? driverError.code : '';
    const constraint = driverError?.constraint ?? exception.constraint;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'A database error occurred';
    const duplicate =
      code === '23505' ||
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      /^UQ_/i.test(constraint ?? '');
    const referenced =
      code === '23503' || code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
    const concurrent = ['40001', '40P01', '55P03'].includes(code);
    if (duplicate) {
      status = HttpStatus.CONFLICT;
      message = 'A record with that value already exists';
    } else if (referenced) {
      status = HttpStatus.CONFLICT;
      message =
        'The record is still in use or references an unavailable record';
    } else if (concurrent) {
      status = HttpStatus.CONFLICT;
      message = 'The record is being changed by another request. Please retry';
    }
    // SQL, bound parameters, constraint details, and driver messages can contain
    // credentials or submitted values. Log only a recognized database error code.
    const safeCode = /^(?:[0-9A-Z]{5}|SQLITE_CONSTRAINT_[A-Z]+)$/.test(code)
      ? code
      : 'unknown';
    Logger.error(`Database query failed (code=${safeCode})`);
    host.switchToHttp().getResponse<Response>().status(status).json({
      statusCode: status,
      error: STATUS_CODES[status],
      message,
    });
  }
}
