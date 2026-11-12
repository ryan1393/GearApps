import { environmentProblems, environmentWithDefaults } from './environment-settings';
import { parseCorsOrigins, parseTrustProxy } from './http.config';

const VALID = {
  JWT_ACCESS_SECRET: 'unit-test-access-secret-no-production-use',
  JWT_REFRESH_SECRET: 'unit-test-refresh-secret-no-production-use',
  DATABASE_TYPE: 'better-sqlite3',
  DATABASE_PATH: ':memory:',
};

describe('HTTP settings', () => {
  it('reads TRUST_PROXY in the forms Express accepts', () => {
    expect(parseTrustProxy(undefined)).toEqual(['loopback', 'uniquelocal']);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('Loopback, 10.0.0.0/8, ::1')).toEqual(['loopback', '10.0.0.0/8', '::1']);
    expect(parseTrustProxy('everyone')).toBeNull();
    expect(parseTrustProxy('loopback; rm')).toBeNull();
  });

  it('reads CORS_ORIGINS as any origin or an exact list', () => {
    expect(parseCorsOrigins('*')).toEqual({ origin: '*', credentials: false });
    expect(parseCorsOrigins(undefined)).toEqual({ origin: '*', credentials: false });
    expect(parseCorsOrigins('http://server:4200/, https://gear.example')).toEqual({
      origin: ['http://server:4200', 'https://gear.example'],
      credentials: true,
    });
    expect(parseCorsOrigins('')).toBeNull();
  });

  it('validates TRUST_PROXY and CORS_ORIGINS with the environment', () => {
    expect(environmentWithDefaults(VALID)['TRUST_PROXY']).toBe('loopback, uniquelocal');
    expect(environmentProblems({ ...VALID, TRUST_PROXY: 'everyone' })).toHaveLength(1);
    expect(environmentProblems({ ...VALID, CORS_ORIGINS: 'http://a:4200,https://b' })).toEqual([]);
    expect(environmentProblems({ ...VALID, CORS_ORIGINS: 'http://a:4200/path' })).toHaveLength(1);
  });

  it('turns the Swagger page off by default only in production', () => {
    expect(environmentWithDefaults(VALID)['ENABLE_SWAGGER']).toBe('true');
    expect(environmentWithDefaults({ ...VALID, NODE_ENV: 'production' })['ENABLE_SWAGGER']).toBe('false');
    expect(environmentWithDefaults({ ...VALID, NODE_ENV: 'production', ENABLE_SWAGGER: 'true' })['ENABLE_SWAGGER']).toBe('true');
  });
});
