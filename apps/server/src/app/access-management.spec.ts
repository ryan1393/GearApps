import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DataSource } from 'typeorm';
import { AccessManagementService, CustomRoleGuard } from './access-management';
import { BadgeAccessService, badgeHash } from './badge-access';

class Screen {
  read() {
    return undefined;
  }
}
Reflect.defineMetadata(PATH_METADATA, 'trays', Screen);
const context = (role = 'user'): ExecutionContext =>
  ({
    getHandler: () => Screen.prototype.read,
    getClass: () => Screen,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  }) as unknown as ExecutionContext;

describe('custom role enforcement', () => {
  it('supports controllers mounted at multiple route aliases', () => {
    class Aliased {
      list() {
        return undefined;
      }
    }
    Reflect.defineMetadata(PATH_METADATA, ['parts', 'part'], Aliased);
    Reflect.defineMetadata('method', 0, Aliased.prototype.list);
    const discovery = { getControllers: () => [{ metatype: Aliased }] };
    const service = new AccessManagementService({} as never, discovery as never, new Reflector());
    expect(service.catalog()[0]).toMatchObject({
      key: 'parts,part:list',
      screen: 'parts,part',
      method: 'GET',
    });
  });
  const reflector = new Reflector();
  it('preserves unassigned accounts and administrator access', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const guard = new CustomRoleGuard({ query } as unknown as DataSource, reflector);
    expect(await guard.canActivate(context())).toBe(true);
    query.mockClear();
    expect(await guard.canActivate(context('admin'))).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
  it('permits only an explicitly granted action and immediately respects changes', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ enabled: true, permissions: ['trays:read'] }])
      .mockResolvedValueOnce([{ enabled: true, permissions: [] }])
      .mockResolvedValueOnce([{ enabled: false, permissions: ['trays:read'] }]);
    const guard = new CustomRoleGuard({ query } as unknown as DataSource, reflector);
    expect(await guard.canActivate(context())).toBe(true);
    await expect(guard.canActivate(context())).rejects.toThrow('assigned role');
    await expect(guard.canActivate(context())).rejects.toThrow('assigned role');
  });
});

describe('badge authentication', () => {
  const setup = (badge: unknown = { user_id: 'u', revoked_at: null }, active = true, role = 'user') => {
    const query = jest.fn().mockResolvedValue(badge ? [badge] : []);
    const getTokens = jest
      .fn()
      .mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
    const findUser = jest
      .fn()
      .mockResolvedValue({ id: 'u', active, role, email: 'operator@example.com' });
    const transactionQuery = jest.fn().mockResolvedValue(badge ? [badge] : []);
    const transaction = (work: (manager: { query: typeof transactionQuery }) => Promise<unknown>) =>
      work({ query: transactionQuery });
    const service = new BadgeAccessService(
      { query, transaction } as never,
      { findUser } as never,
      { getTokens } as never,
      {} as never,
    );
    return { service, query, transactionQuery, findUser, getTokens };
  };
  it('uses normal session generation and never queries with a plain UID', async () => {
    const { service, query, getTokens } = setup();
    await expect(service.login({ uid: 'ABC123' }, '127.0.0.1')).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    expect(query.mock.calls[0][1]).toEqual([badgeHash('abc123')]);
    expect(getTokens).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown, revoked, and inactive credentials without issuing tokens', async () => {
    for (const [badge, active, message] of [
      [null, true, 'not recognized'],
      [{ user_id: 'u', revoked_at: new Date() }, true, 'revoked'],
      [{ user_id: 'u', revoked_at: null }, false, 'inactive'],
    ] as const) {
      const { service, getTokens } = setup(badge, active);
      await expect(service.login({ uid: 'ABC123' }, 'local')).rejects.toThrow(message);
      expect(getTokens).not.toHaveBeenCalled();
    }
  });
  it('bounds repeated badge attempts per source address', async () => {
    const { service, query } = setup(null);
    for (let attempt = 0; attempt < 10; attempt++)
      await expect(service.login({ uid: 'bad' }, 'local')).rejects.toThrow('not recognized');
    await expect(service.login({ uid: 'bad' }, 'local')).rejects.toThrow('Too many');
    expect(query).toHaveBeenCalledTimes(10);
  });
  it('answers 429 with Retry-After once limited', async () => {
    const { service } = setup(null);
    for (let attempt = 0; attempt < 10; attempt++)
      await service.login({ uid: 'bad' }, 'local').catch(() => undefined);
    const response = { setHeader: jest.fn() };
    const error = await service.login({ uid: 'bad' }, 'local', response as never).catch((thrown) => thrown);
    expect(error.getStatus()).toBe(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
  });
  it('does not let a successful badge clear the failures of its address', async () => {
    const { service, query } = setup();
    const unknown = () => query.mockResolvedValueOnce([]);
    for (let attempt = 0; attempt < 9; attempt++) {
      unknown();
      await expect(service.login({ uid: 'guess' }, 'local')).rejects.toThrow('not recognized');
    }
    await expect(service.login({ uid: 'ABC123' }, 'local')).resolves.toHaveProperty('accessToken');
    unknown();
    await expect(service.login({ uid: 'guess' }, 'local')).rejects.toThrow('not recognized');
    await expect(service.login({ uid: 'ABC123' }, 'local')).rejects.toThrow('Too many badge attempts');
  });
  it('caps failed badge attempts across all addresses', async () => {
    const { service } = setup(null);
    for (let attempt = 0; attempt < 100; attempt++)
      await expect(service.login({ uid: 'bad' }, `10.0.${attempt >> 8}.${attempt & 255}`)).rejects.toThrow('not recognized');
    await expect(service.login({ uid: 'bad' }, '192.0.2.1')).rejects.toThrow('on this server');
  });
  it('refuses badge sign-in for administrators', async () => {
    const { service, getTokens } = setup(undefined, true, 'admin');
    const error = await service.login({ uid: 'ABC123' }, 'local').catch((thrown) => thrown);
    expect(error.getStatus()).toBe(403);
    expect(error.message).toBe('Administrators sign in with email and password.');
    expect(getTokens).not.toHaveBeenCalled();
  });
  it('rejects revocation between the initial UID lookup and reading the account version', async () => {
    const { service, transactionQuery, findUser, getTokens } = setup();
    transactionQuery
      .mockResolvedValueOnce([{ id: 'u' }])
      .mockResolvedValueOnce([{ revoked_at: new Date() }]);
    await expect(service.login({ uid: 'ABC123' }, 'local')).rejects.toThrow('revoked');
    expect(findUser).not.toHaveBeenCalled();
    expect(getTokens).not.toHaveBeenCalled();
  });
});
