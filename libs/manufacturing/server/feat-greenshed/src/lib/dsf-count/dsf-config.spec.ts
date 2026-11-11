import { DSF_PRIVILEGED_ACK, dsfAccountPolicy, readDsfConfig } from './dsf-count.service';
import { DsfRefusal } from './dsf-core';

const base = {
  DSF_COUNT_ENABLED: 'true', DSF_DB_HOST: '10.16.80.10', DSF_DB_PORT: '5432', DSF_DB_NAME: 'maindblocal',
  DSF_DB_USER: 'dana_dsf_reader', DSF_DB_PASSWORD: 'secret', DSF_DB_SSL_MODE: 'disable', DSF_COUNT_MACHINES: '516,517',
  DATABASE_HOST: 'dana-postgres', DATABASE_NAME: 'MeshForge',
} as NodeJS.ProcessEnv;

describe('DSF connection settings', () => {
  it('is off, and reads nothing, unless DSF_COUNT_ENABLED is exactly true', () => {
    expect(readDsfConfig({})).toMatchObject({ enabled: false, valid: false });
    expect(readDsfConfig({ ...base, DSF_COUNT_ENABLED: 'TRUE' })).toMatchObject({ enabled: false, valid: false });
  });

  it('accepts a complete configuration with a read-only session', () => {
    const config = readDsfConfig(base);
    expect(config).toMatchObject({ enabled: true, valid: true, interval: 60 });
    expect([...config.machines]).toEqual(['516', '517']);
    expect(config.client).toMatchObject({ host: '10.16.80.10', port: 5432, database: 'maindblocal', ssl: false, options: '-c default_transaction_read_only=on' });
  });

  it('stays off for incomplete or unsafe settings instead of guessing', () => {
    const invalid = (changes: NodeJS.ProcessEnv) => readDsfConfig({ ...base, ...changes }).valid;
    expect(invalid({ DSF_DB_PASSWORD: '' })).toBe(false);
    // Admin-approved sources do not need an archived reference allowlist.
    expect(invalid({ DSF_COUNT_MACHINES: '' })).toBe(true);
    expect(invalid({ DSF_COUNT_MACHINES: '516,516' })).toBe(false);
    expect(invalid({ DSF_DB_PORT: 'abc' })).toBe(false);
    expect(invalid({ DSF_DB_SSL_MODE: 'prefer' })).toBe(false);
    expect(invalid({ DSF_COUNT_INTERVAL_SECONDS: '5' })).toBe(false);
    // Never the MeshForge database itself.
    expect(invalid({ DSF_DB_HOST: 'dana-postgres', DSF_DB_NAME: 'MeshForge' })).toBe(false);
    // An acknowledgment with the wrong text, or for a different source, is refused.
    expect(invalid({ DSF_PRIVILEGED_READER_ACK: 'yes' })).toBe(false);
    expect(invalid({ DSF_PRIVILEGED_READER_ACK: DSF_PRIVILEGED_ACK, DSF_DB_HOST: '10.0.0.9' })).toBe(false);
    expect(invalid({ DSF_PRIVILEGED_READER_ACK: DSF_PRIVILEGED_ACK, DSF_DB_USER: 'postgres' })).toBe(false);
  });

  it('requires a restricted read-only login unless the privileged account was explicitly acknowledged', () => {
    const config = readDsfConfig(base);
    const account = { database_name: 'maindblocal', session_login: 'dana_dsf_reader', effective_login: 'dana_dsf_reader', read_only: true };
    const restricted = { can_read: true, role_safe: true, no_database_create: true, no_schema_create: true, no_source_writes: true };
    const privileged = { ...restricted, role_safe: false };
    const reason = (run: () => unknown) => { try { run(); } catch (e) { return e instanceof DsfRefusal ? e.reason : 'OTHER'; } return 'NONE'; };
    expect(dsfAccountPolicy(config, account, restricted)).toBe('RESTRICTED_ROLE_CHECKS_PASSED');
    expect(reason(() => dsfAccountPolicy(config, account, privileged))).toBe('READ_ONLY_ROLE_REQUIRED');
    expect(reason(() => dsfAccountPolicy(config, { ...account, read_only: false }, restricted))).toBe('SOURCE_ACCOUNT_MISMATCH');
    const acknowledged = readDsfConfig({ ...base, DSF_PRIVILEGED_READER_ACK: DSF_PRIVILEGED_ACK });
    expect(dsfAccountPolicy(acknowledged, account, privileged)).toBe('USER_APPROVED_PRIVILEGED_ACCOUNT_APP_READ_ONLY');
    // The DSF application's own login is accepted with the acknowledgment, never without it.
    const whiteboard = { ...account, session_login: 'whiteboard', effective_login: 'whiteboard' };
    const whiteboardEnv = { ...base, DSF_DB_USER: 'whiteboard' };
    expect(reason(() => dsfAccountPolicy(readDsfConfig(whiteboardEnv), whiteboard, privileged))).toBe('READ_ONLY_ROLE_REQUIRED');
    const whiteboardAcknowledged = readDsfConfig({ ...whiteboardEnv, DSF_PRIVILEGED_READER_ACK: DSF_PRIVILEGED_ACK });
    expect(whiteboardAcknowledged.valid).toBe(true);
    expect(dsfAccountPolicy(whiteboardAcknowledged, whiteboard, privileged)).toBe('USER_APPROVED_PRIVILEGED_ACCOUNT_APP_READ_ONLY');
  });
});
