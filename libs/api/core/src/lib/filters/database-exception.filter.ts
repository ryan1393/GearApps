import { ApiErrorResponse } from '@gearapps/shared/domain';
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { EntityNotFoundError, QueryFailedError, TypeORMError } from 'typeorm';

/** Maps TypeORM errors to clean HTTP responses without leaking SQL. */
@Catch(TypeORMError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: TypeORMError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error';

    if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Record not found';
    } else if (exception instanceof QueryFailedError) {
      const text = exception.message.toLowerCase();
      if (text.includes('unique') || text.includes('duplicate')) {
        status = HttpStatus.CONFLICT;
        message = 'A record with those values already exists';
      } else if (text.includes('foreign key') || text.includes('reference constraint')) {
        status = HttpStatus.CONFLICT;
        message = 'Record is referenced by other data';
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = 'Database query failed';
      }
    }

    this.logger.error(`${exception.constructor.name}: ${exception.message}`);
    const body: ApiErrorResponse = {
      statusCode: status,
      message,
      error: exception.constructor.name,
    };
    response.status(status).json(body);
  }
}
