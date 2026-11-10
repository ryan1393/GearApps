import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCollectorToken, PostgresCollectorTokens } from './collector-tokens';

type Call = { sql: string; params: unknown[] };

function fakeCatalog() {
  const calls: Call[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('RETURNING id,purpose')) return [{ id: params[0], purpose: 'docker' }];
    return [];
  });
  const db = { query, transaction: jest.fn(async (work: (m: { query: typeof query }) => Promise<void>) => work({ query })) };
  return { catalog: { db } as never, calls };
}

describe('Docker collector connection', () => {
  let dir: string;
  const previous = process.env['LAPPER_READ_TOKEN_FILE'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gear-collector-token-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env['LAPPER_READ_TOKEN_FILE'];
    else process.env['LAPPER_READ_TOKEN_FILE'] = previous;
  });

  it('revokes the previous Docker token, stores only the new hash and hands the token over by file', async () => {
    const file = join(dir, 'collector', 'token');
    process.env['LAPPER_READ_TOKEN_FILE'] = file;
    const { catalog, calls } = fakeCatalog();
    const service = new PostgresCollectorTokens(catalog);

    const connection = await service.connectDocker('admin-1');

    const token = readFileSync(file, 'utf8').trim();
    expect(token).toMatch(/^glr_/);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    const revoke = calls.findIndex((c) => c.sql.includes("purpose='docker' AND revoked_at IS NULL"));
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO lapper.collector_tokens'));
    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(insert as Call)).toBeGreaterThan(revoke);
    expect(insert?.params).toEqual([
      expect.any(String), 'Docker collector', hashCollectorToken(token), token.slice(-4), 'admin-1', 'docker',
    ]);
    expect(JSON.stringify(calls)).not.toContain(token);
    expect(connection.available).toBe(true);
  });

  it('removes the token file when the Docker token is revoked', async () => {
    const file = join(dir, 'token');
    process.env['LAPPER_READ_TOKEN_FILE'] = file;
    const { catalog } = fakeCatalog();
    const service = new PostgresCollectorTokens(catalog);
    await service.connectDocker('admin-1');
    await service.revoke('t1');
    expect(() => statSync(file)).toThrow();
  });

  it('refuses to connect outside the Docker stack', async () => {
    delete process.env['LAPPER_READ_TOKEN_FILE'];
    const { catalog, calls } = fakeCatalog();
    const service = new PostgresCollectorTokens(catalog);
    await expect(service.connectDocker('admin-1')).rejects.toThrow('not running in the Docker stack');
    expect(calls).toEqual([]);
    expect((await service.dockerConnection()).available).toBe(false);
  });
});
