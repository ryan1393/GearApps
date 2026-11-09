import { ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { isQueryFailedError, QueryFailedFilter } from './query-failed.filter';

describe('QueryFailedFilter', () => {
  const sensitive = 'private-value-and-database-internals';
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  function capture(code: string | undefined, constraint?: string) {
    const driver = Object.assign(new Error(sensitive), {
      code,
      constraint,
      detail: sensitive,
    });
    const error = new QueryFailedError(`SQL ${sensitive}`, [sensitive], driver);
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new QueryFailedFilter(new Reflector()).catch(error, host);
    const body = response.json.mock.calls[0][0] as {
      statusCode: number;
      error: string;
      message: string;
    };
    expect(response.status).toHaveBeenCalledWith(body.statusCode);
    expect(JSON.stringify(body)).not.toContain(sensitive);
    expect(JSON.stringify(log.mock.calls)).not.toContain(sensitive);
    return body;
  }
  it.each(['uq_custom_name', 'users_email_key', 'index_without_prefix'])(
    'maps PostgreSQL duplicate code independently of constraint naming: %s',
    (constraint) => {
      expect(capture('23505', constraint)).toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        message: 'A record with that value already exists',
      });
    },
  );
  it('maps a foreign-key conflict without exposing referenced tables or values', () => {
    expect(capture('23503')).toMatchObject({
      statusCode: HttpStatus.CONFLICT,
      message: expect.stringContaining('still in use'),
    });
  });
  it.each(['40001', '40P01', '55P03'])(
    'maps retryable concurrency failure %s to a conflict',
    (code) => {
      expect(capture(code)).toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        message: expect.stringContaining('Please retry'),
      });
    },
  );
  it.each([
    'SQLITE_CONSTRAINT_UNIQUE',
    'SQLITE_CONSTRAINT_PRIMARYKEY',
    'SQLITE_CONSTRAINT_FOREIGNKEY',
  ])('preserves isolated SQLite constraint handling: %s', (code) => {
    expect(capture(code).statusCode).toBe(HttpStatus.CONFLICT);
  });
  it('supports legacy TypeORM unique constraint metadata', () => {
    expect(capture(undefined, 'UQ_existing_constraint').statusCode).toBe(
      HttpStatus.CONFLICT,
    );
  });
  it.each(['XX000', undefined, 'untrusted driver code with values'])(
    'sanitizes an unexpected error in every environment: %s',
    (code) => {
      expect(capture(code)).toEqual({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'A database error occurred',
      });
    },
  );
  it('recognizes only actual TypeORM query failures', () => {
    expect(
      isQueryFailedError(
        new QueryFailedError('query', [], new Error('failure')),
      ),
    ).toBe(true);
    expect(isQueryFailedError(new Error('failure'))).toBe(false);
  });
});
