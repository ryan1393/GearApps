import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { collectorTokenAllows, CollectorTokenResolver } from '@gearapps/shared/domain';
import { JwtAccessTokenGuard } from './jwt-access.guard';

const context = (method: string, url: string, authorization?: string) => {
  const request: Record<string, unknown> = { method, originalUrl: url, url, headers: { authorization } };
  return {
    request,
    ctx: {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    } as unknown as ExecutionContext,
  };
};

describe('collector tokens at the access guard', () => {
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const user = {
    id: 'admin-1', email: 'collector-token:Plant 1', role: 'user' as const,
    departmentId: null, departmentCode: null, departmentDescription: null, collectorTokenId: 't1',
  };
  const resolver: CollectorTokenResolver = {
    resolve: jest.fn(async (token: string) => (token === 'glr_valid' ? user : null)),
  };
  const guard = new JwtAccessTokenGuard(reflector, resolver);

  it('accepts a valid token on a collector endpoint and sets the request user', async () => {
    const { ctx, request } = context('POST', '/api/v1/machine-cycle', 'Bearer glr_valid');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request['user']).toEqual(user);
  });

  it('rejects unknown or revoked tokens', async () => {
    const { ctx } = context('GET', '/api/v1/machine', 'Bearer glr_revoked');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps tokens away from everything a collector does not need', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/users/me'],
      ['PATCH', '/api/v1/machine/123'],
      ['POST', '/api/v1/collector-token'],
      ['GET', '/api/v1/part'],
      ['DELETE', '/api/v1/machine-cycle/1'],
    ]) {
      const { ctx } = context(method, url, 'Bearer glr_valid');
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('rejects collector tokens when no resolver is configured', async () => {
    const { ctx } = context('GET', '/api/v1/machine', 'Bearer glr_valid');
    await expect(new JwtAccessTokenGuard(reflector).canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('collectorTokenAllows', () => {
  it.each([
    ['GET', '/api/v1/machine'],
    ['GET', '/api/v1/machine/ip/10.16.81.15?number=01-094-101'],
    ['GET', '/api/v1/macro-log/summary/m/g'],
    ['GET', '/api/v1/gearset/number/373'],
    ['POST', '/api/v1/macro-log'],
    ['POST', '/api/v1/gearset'],
    ['PATCH', '/api/v1/scanner-detail/s1/serial-numbers'],
    ['PATCH', '/api/v1/machine-fanuc-variable/v1'],
  ])('allows %s %s', (method, url) => expect(collectorTokenAllows(method, url)).toBe(true));

  it.each([
    ['PATCH', '/api/v1/scanner-detail/s1'],
    ['PUT', '/api/v1/machine-fanuc-variable/v1'],
    ['GET', '/api/v1/machine/../users'],
    ['GET', '/machine'],
    ['DELETE', '/api/v1/macro/m1'],
  ])('denies %s %s', (method, url) => expect(collectorTokenAllows(method, url)).toBe(false));
});
