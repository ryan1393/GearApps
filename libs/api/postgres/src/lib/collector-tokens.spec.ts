import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCollectorToken, PostgresCollectorTokens } from './collector-tokens';

type Call = { sql: string; params: unknown[] };

function fakeCatalog(readFile: () => string = () => '') {
  const calls: Call[] = [];
  const events: string[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('INSERT INTO lapper.collector_tokens')) {
      let present = '';
      try {
        present = readFile();
      } catch {
        present = '';
      }
      events.push(present ? 'insert (file already written)' : 'insert (no file yet)');
    }
    if (sql.includes("purpose='docker' AND revoked_at IS NULL")) events.push('revoke previous docker');
    if (sql.includes("SET purpose='docker'")) events.push(`mark ${String(params[0])} as docker`);
    if (sql.includes('RETURNING id,purpose')) return [{ id: params[0], purpose: 'docker' }];
    return [];
  });
  const db = {
    query,
    transaction: jest.fn(async (work: (m: { query: typeof query }) => Promise<void>) => {
      let present = '';
      try {
        present = readFile();
      } catch {
        present = '';
      }
      events.push(present.startsWith('glr_') ? 'begin (file has the new token)' : 'begin (no file)');
      await work({ query });
      events.push('commit');
    }),
  };
  return { catalog: { db } as never, calls, events };
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

  it('commits the new token, then writes the file, then revokes the previous Docker token', async () => {
    const file = join(dir, 'collector', 'token');
    process.env['LAPPER_READ_TOKEN_FILE'] = file;
    const { catalog, calls, events } = fakeCatalog(() => readFileSync(file, 'utf8').trim());
    const service = new PostgresCollectorTokens(catalog);

    const connection = await service.connectDocker('admin-1');

    const token = readFileSync(file, 'utf8').trim();
    expect(token).toMatch(/^glr_/);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO lapper.collector_tokens'));
    expect(insert?.params).toEqual([
      expect.any(String), 'Docker collector', hashCollectorToken(token), token.slice(-4), 'admin-1', null,
    ]);
    // The insert ran on its own (committed) before the file existed; the file was in place
    // before the transaction that revokes the old token and marks the new one as Docker's.
    expect(events).toEqual([
      'insert (no file yet)',
      'begin (file has the new token)',
      "revoke previous docker",
      `mark ${String(insert?.params[0])} as docker`,
      'commit',
    ]);
    expect(JSON.stringify(calls)).not.toContain(token);
    expect(connection.available).toBe(true);
  });

  it('leaves the current token in place and says so when the file cannot be written', async () => {
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, 'old');
    process.env['LAPPER_READ_TOKEN_FILE'] = join(file, 'token');
    const { catalog, calls, events } = fakeCatalog();
    const service = new PostgresCollectorTokens(catalog);
    await expect(service.connectDocker('admin-1')).rejects.toThrow(
      /Could not write the Docker collector token .*the collector keeps its current token/,
    );
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO lapper.collector_tokens'));
    const revokeNew = calls.find((c) => c.sql.includes('WHERE id=$1') && c.sql.includes('revoked_at=clock_timestamp()'));
    expect(revokeNew?.params).toEqual([insert?.params[0]]);
    expect(events).not.toContain('revoke previous docker');
    // The next attempt is not blocked by the failed one.
    process.env['LAPPER_READ_TOKEN_FILE'] = join(dir, 'token');
    await expect(new PostgresCollectorTokens(catalog).connectDocker('admin-1')).resolves.toBeDefined();
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
