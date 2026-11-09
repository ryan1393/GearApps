import { Response } from 'express';
import { EntityNotFoundError } from 'typeorm';

import { ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Converts TypeORM findOneOrFail()/findOneByOrFail() misses into an HTTP 404.
 *
 * Without this filter, EntityNotFoundError is not an HttpException and Nest
 * reports it as a 500 even though the request simply referenced a record that
 * does not exist.
 */
@Catch(EntityNotFoundError)
export class EntityNotFoundFilter extends BaseExceptionFilter {
  public override catch(exception: EntityNotFoundError, host: ArgumentsHost) {
    Logger.warn(`Database entity was not found: ${exception.message}`);

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(HttpStatus.NOT_FOUND).json({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
      message: 'The requested record could not be found',
      ...(process.env['NODE_ENV'] !== 'production'
        ? { detail: exception.message }
        : {}),
    });
  }
}
