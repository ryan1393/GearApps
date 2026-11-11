import { decryptEnvironmentValue, recordEnvironmentStartupState } from '@meshforge/manufacturing/server/util-common';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EnvironmentSettingsService } from './environment-settings.service';

const SECRET = 'unit-test-access-secret-no-production-use';
const BASELINE = {
  JWT_ACCESS_SECRET: SECRET,
  JWT_REFRESH_SECRET: 'unit-test-refresh-secret-no-production-use',
  DATABASE_TYPE: 'better-sqlite3',
  DATABASE_PATH: ':memory:',
  SCANNER_TIMEOUT_MS: '4000',
  EMAIL_PASSWORD: 'server-mail-password',
};

interface Row { key: string; value: string; encrypted: boolean; updated_at: string }

/** A stand-in for the settings table that understands the three statements the service sends. */
async function setup(initial: Row[] = [], applied: Record<string, string> = {}) {
  const rows = new Map(initial.map((row) => [row.key, row]));
  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.startsWith('DELETE')) rows.delete(parameters[0] as string);
    else if (sql.startsWith('INSERT')) {
      const [key, value, encrypted] = parameters as [string, string, boolean];
      rows.set(key, { key, value, encrypted, updated_at: '2026-01-01T00:00:00Z' });
    } else if (sql.startsWith('SELECT key')) return [...rows.values()];
    return [];
  });
  const dataSource = { options: { type: 'postgres' }, query, transaction: (work: (manager: { query: typeof query }) => unknown) => work({ query }) };
  recordEnvironmentStartupState({ baseline: { ...BASELINE }, applied });
  const service = new EnvironmentSettingsService(dataSource as unknown as DataSource);
  await service.onModuleInit();
  const find = async (key: string) => (await service.board()).groups.flatMap((group) => group.settings).find((setting) => setting.key === key);
  return { service, rows, query, find };
}

describe('EnvironmentSettingsService', () => {
  it('shows server values and never sends a secret', async () => {
    const { service, find } = await setup();
    const board = await service.board();
    expect(board.available).toBe(true);
    expect(board.restart_required).toBe(false);
    expect(await find('SCANNER_TIMEOUT_MS')).toMatchObject({ value: '4000', source: 'ENVIRONMENT', editable: true, pending: false });
    expect(await find('EMAIL_PASSWORD')).toMatchObject({ value: null, environment_value: null, is_set: true, secret: true });
    expect(await find('JWT_ACCESS_SECRET')).toMatchObject({ value: null, editable: false, is_set: true });
    expect(JSON.stringify(board)).not.toContain('server-mail-password');
    expect(JSON.stringify(board)).not.toContain(SECRET);
  });

  it('saves a value, reports the restart, and goes back to the server value', async () => {
    const { service, find, rows } = await setup();
    const saved = await service.save([{ key: 'SCANNER_TIMEOUT_MS', value: ' 9000 ' }], 'user-1');
    expect(saved.restart_required).toBe(true);
    expect(await find('SCANNER_TIMEOUT_MS')).toMatchObject({ value: '9000', source: 'ADMIN', pending: true, environment_value: '4000' });

    const reset = await service.save([{ key: 'SCANNER_TIMEOUT_MS', value: null }], 'user-1');
    expect(rows.size).toBe(0);
    expect(reset.restart_required).toBe(false);
    expect(await find('SCANNER_TIMEOUT_MS')).toMatchObject({ value: '4000', source: 'ENVIRONMENT', pending: false });
  });

  it('is not waiting for a restart once the API started with the saved value', async () => {
    const row = { key: 'SCANNER_TIMEOUT_MS', value: '9000', encrypted: false, updated_at: '2026-01-01T00:00:00Z' };
    const { service } = await setup([row], { SCANNER_TIMEOUT_MS: '9000' });
    expect((await service.board()).restart_required).toBe(false);
  });

  it('stores a secret encrypted', async () => {
    const { service, rows, find } = await setup();
    const board = await service.save([{ key: 'SCANNER_FTP_PASSWORD', value: 'ftp-password' }], 'user-1');
    const stored = rows.get('SCANNER_FTP_PASSWORD');
    expect(stored?.encrypted).toBe(true);
    expect(stored?.value).not.toContain('ftp-password');
    expect(decryptEnvironmentValue(stored?.value ?? '', SECRET)).toBe('ftp-password');
    expect(JSON.stringify(board)).not.toContain('ftp-password');
    expect(await find('SCANNER_FTP_PASSWORD')).toMatchObject({ value: null, is_set: true, source: 'ADMIN' });
  });

  it('refuses locked and unknown settings', async () => {
    const { service, rows } = await setup();
    await expect(service.save([{ key: 'JWT_ACCESS_SECRET', value: 'a-new-signing-secret-chosen-in-admin' }], 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save([{ key: 'DATABASE_HOST', value: 'elsewhere' }], 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save([{ key: 'PATH', value: '/tmp' }], 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.size).toBe(0);
  });

  it('refuses values the API could not start with', async () => {
    const { service, rows } = await setup();
    await expect(service.save([{ key: 'GEAR_LABEL_PRINTER_PORT', value: '70000' }], 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save([{ key: 'SCANNER_TIMEOUT_MS', value: 'soon' }], 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save([{ key: 'EMAIL_ENABLED', value: 'true' }], 'user-1')).rejects.toThrow(/EMAIL_HOST/);
    await expect(service.save([{ key: 'CORS_ORIGINS', value: 'a\nb' }], 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.size).toBe(0);
  });

  it('only restarts under Docker', async () => {
    const { service } = await setup();
    const before = process.env['ENVIRONMENT'];
    process.env['ENVIRONMENT'] = 'test';
    try {
      expect(() => service.restart('user-1')).toThrow(/Docker/);
    } finally {
      if (before === undefined) delete process.env['ENVIRONMENT']; else process.env['ENVIRONMENT'] = before;
    }
  });
});
