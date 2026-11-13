import { dbConfig, environmentFlag } from './database.config';

describe('database config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads environment flags as booleans', () => {
    expect(environmentFlag('true')).toBe(true);
    expect(environmentFlag(' TRUE ')).toBe(true);
    expect(environmentFlag('false')).toBe(false);
    expect(environmentFlag('')).toBe(false);
    expect(environmentFlag(undefined)).toBe(false);
  });

  it('passes query logging to TypeORM as a boolean', () => {
    process.env['DATABASE_LOGGING_ENABLED'] = 'true';
    expect(dbConfig().logging).toBe(true);
    process.env['DATABASE_LOGGING_ENABLED'] = 'false';
    expect(dbConfig().logging).toBe(false);
    delete process.env['DATABASE_LOGGING_ENABLED'];
    expect(dbConfig().logging).toBe(false);
  });
});
