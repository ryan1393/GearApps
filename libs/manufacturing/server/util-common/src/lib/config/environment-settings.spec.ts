import {
  decryptEnvironmentValue,
  encryptEnvironmentValue,
  ENVIRONMENT_SETTINGS,
  environmentProblems,
  environmentWithDefaults,
  readEnvironmentOverlay,
} from './environment-settings';
import { validationSchema } from './schema';

const VALID = {
  JWT_ACCESS_SECRET: 'unit-test-access-secret-no-production-use',
  JWT_REFRESH_SECRET: 'unit-test-refresh-secret-no-production-use',
  DATABASE_TYPE: 'better-sqlite3',
  DATABASE_PATH: ':memory:',
};

describe('environment settings', () => {
  it('lists every setting of the validation schema exactly once', () => {
    const listed = ENVIRONMENT_SETTINGS.map((setting) => setting.key);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(validationSchema.describe()['keys']).sort());
  });

  it('keeps startup, signing and server-file settings locked', () => {
    const locked = ENVIRONMENT_SETTINGS.filter((setting) => setting.locked).map((setting) => setting.key);
    expect(locked).toEqual(expect.arrayContaining([
      'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_HOST', 'DATABASE_PASSWORD', 'DATABASE_SYNCHRONIZE',
      'SERVER_PORT', 'API_PREFIX', 'DSF_DB_PASSWORD_FILE', 'DSF_DB_SSL_CA_FILE', 'DSF_PRIVILEGED_READER_ACK',
      'EMAIL_TEMPLATE_DIR', 'SWAGGER_JSON_FILE',
    ]));
  });

  it('marks every password as a secret', () => {
    const plain = ENVIRONMENT_SETTINGS.filter((setting) => /PASSWORD$|SECRET$/.test(setting.key) && !setting.secret);
    expect(plain).toEqual([]);
  });

  it('reports problems without repeating the rejected value', () => {
    expect(environmentProblems(VALID)).toEqual([]);
    const problems = environmentProblems({ ...VALID, DSF_COUNT_MACHINES: 'not a machine!', GEAR_LABEL_PRINTER_PORT: '70000' });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).not.toContain('not a machine!');
  });

  it('fills in schema defaults as text', () => {
    const values = environmentWithDefaults(VALID);
    expect(values['SERVER_PORT']).toBe('3333');
    expect(values['ENABLE_SWAGGER']).toBe('true');
    expect(values['SCANNER_FTP_ROOT']).toBe('181-lapper-scanners');
  });

  it('encrypts secrets so only the same signing secret reads them', () => {
    const stored = encryptEnvironmentValue('ftp-password', VALID.JWT_ACCESS_SECRET);
    expect(stored).not.toContain('ftp-password');
    expect(decryptEnvironmentValue(stored, VALID.JWT_ACCESS_SECRET)).toBe('ftp-password');
    expect(decryptEnvironmentValue(stored, 'another-signing-secret-entirely')).toBeNull();
    expect(decryptEnvironmentValue('not encrypted', VALID.JWT_ACCESS_SECRET)).toBeNull();
  });

  it('never applies locked, unknown or unreadable saved values', () => {
    const overlay = readEnvironmentOverlay([
      { key: 'SCANNER_TIMEOUT_MS', value: '9000', encrypted: false },
      { key: 'SCANNER_FTP_PASSWORD', value: encryptEnvironmentValue('ftp-password', VALID.JWT_ACCESS_SECRET), encrypted: true },
      { key: 'EMAIL_PASSWORD', value: encryptEnvironmentValue('mail', 'a-signing-secret-that-was-replaced'), encrypted: true },
      { key: 'JWT_ACCESS_SECRET', value: 'attacker-chosen-signing-secret', encrypted: false },
      { key: 'DATABASE_HOST', value: 'elsewhere', encrypted: false },
      { key: 'NOT_A_SETTING', value: 'x', encrypted: false },
    ], VALID.JWT_ACCESS_SECRET);
    expect(overlay.values).toEqual({ SCANNER_TIMEOUT_MS: '9000', SCANNER_FTP_PASSWORD: 'ftp-password' });
    expect(overlay.skipped.sort()).toEqual(['DATABASE_HOST', 'EMAIL_PASSWORD', 'JWT_ACCESS_SECRET', 'NOT_A_SETTING']);
  });
});
