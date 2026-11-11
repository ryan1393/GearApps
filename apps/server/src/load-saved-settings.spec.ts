import { encryptEnvironmentValue, environmentStartupState } from '@meshforge/manufacturing/server/util-common';

import { applySavedEnvironmentSettings } from './load-saved-settings';

const SECRET = 'unit-test-access-secret-no-production-use';
const environment = (): NodeJS.ProcessEnv => ({
  JWT_ACCESS_SECRET: SECRET,
  JWT_REFRESH_SECRET: 'unit-test-refresh-secret-no-production-use',
  DATABASE_TYPE: 'postgres',
  DATABASE_HOST: 'db',
  DATABASE_PORT: '5432',
  DATABASE_USERNAME: 'api',
  DATABASE_PASSWORD: 'database-password',
  DATABASE_NAME: 'GearApps',
  SCANNER_TIMEOUT_MS: '4000',
});
const NO_FILE = '/nonexistent/.env';

describe('applySavedEnvironmentSettings', () => {
  it('lays saved settings over the environment and remembers what the server had', async () => {
    const env = environment();
    await applySavedEnvironmentSettings(env, async () => [
      { key: 'SCANNER_TIMEOUT_MS', value: '9000', encrypted: false },
      { key: 'SCANNER_FTP_PASSWORD', value: encryptEnvironmentValue('ftp-password', SECRET), encrypted: true },
    ], NO_FILE);
    expect(env['SCANNER_TIMEOUT_MS']).toBe('9000');
    expect(env['SCANNER_FTP_PASSWORD']).toBe('ftp-password');
    expect(environmentStartupState().baseline['SCANNER_TIMEOUT_MS']).toBe('4000');
    expect(environmentStartupState().applied).toEqual({ SCANNER_TIMEOUT_MS: '9000', SCANNER_FTP_PASSWORD: 'ftp-password' });
  });

  it('never lets a saved row replace a locked setting', async () => {
    const env = environment();
    await applySavedEnvironmentSettings(env, async () => [
      { key: 'JWT_ACCESS_SECRET', value: 'attacker-chosen-signing-secret', encrypted: false },
      { key: 'DATABASE_HOST', value: 'elsewhere', encrypted: false },
    ], NO_FILE);
    expect(env['JWT_ACCESS_SECRET']).toBe(SECRET);
    expect(env['DATABASE_HOST']).toBe('db');
    expect(environmentStartupState().applied).toEqual({});
  });

  it('leaves saved settings out when they would stop the API starting', async () => {
    const env = environment();
    await applySavedEnvironmentSettings(env, async () => [
      { key: 'SCANNER_TIMEOUT_MS', value: '9000', encrypted: false },
      { key: 'GEAR_LABEL_PRINTER_PORT', value: '70000', encrypted: false },
    ], NO_FILE);
    expect(env['SCANNER_TIMEOUT_MS']).toBe('4000');
    expect(env['GEAR_LABEL_PRINTER_PORT']).toBeUndefined();
  });

  it('starts on the server environment when the database cannot be read', async () => {
    const env = environment();
    await applySavedEnvironmentSettings(env, async () => { throw new Error('connection refused'); }, NO_FILE);
    expect(env['SCANNER_TIMEOUT_MS']).toBe('4000');
    expect(environmentStartupState().applied).toEqual({});
  });

  it('does not look for saved settings without PostgreSQL', async () => {
    const readRows = jest.fn();
    await applySavedEnvironmentSettings({ ...environment(), DATABASE_TYPE: 'better-sqlite3' }, readRows, NO_FILE);
    expect(readRows).not.toHaveBeenCalled();
  });
});
