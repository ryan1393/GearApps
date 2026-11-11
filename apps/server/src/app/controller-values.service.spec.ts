import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARGONAUT_MACROS } from '@meshforge/shared/domain';
import { ControllerValuesService } from './controller-values.service';

describe('Cycle Test Lab > Read values from machine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collector-'));
  const tokenFile = join(dir, 'token');
  const previous = process.env['LAPPER_READ_TOKEN_FILE'];
  let seen: { url?: string; auth?: string }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body));
  });
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env['LAPPER_READ_TOKEN_FILE'] = tokenFile;
  });
  afterAll(() => {
    server.close();
    if (previous === undefined) delete process.env['LAPPER_READ_TOKEN_FILE'];
    else process.env['LAPPER_READ_TOKEN_FILE'] = previous;
  });
  beforeEach(() => {
    seen = [];
    writeFileSync(tokenFile, 'glr_docker\n');
  });

  const service = (machine = true) => {
    const query = jest.fn(async (sql: string) =>
      sql.includes('lapper.macros') ? [{ number: 500 }, { number: 10039 }] : machine ? [{ number: '01-094-292' }] : [],
    );
    return new ControllerValuesService({ query } as never, { get: () => base } as never);
  };

  it("asks Lapper Read for Argonaut's and the active macros with the collector token, and returns numbers", async () => {
    reply = { status: 200, body: { machine_id: 'm1', read_at: '2026-11-11T19:00:00Z', values: { '10020': '10006253', '10039': '1.25', '500': null } } };
    const read = await service().read('m1', 'user');
    expect(seen[0].auth).toBe('Bearer glr_docker');
    const numbers = new URL(seen[0].url ?? '', base).searchParams.get('numbers')?.split(',').map(Number);
    expect(seen[0].url).toMatch(/^\/machines\/m1\/macros\?/);
    expect(numbers).toHaveLength(ARGONAUT_MACROS.length + 1);
    expect(numbers).toContain(500);
    expect(read.values['10020']).toBe(10006253);
    expect(read.values['10039']).toBe(1.25);
    expect(read.values['500']).toBeNull();
    expect(read.values['10517']).toBeNull();
    expect(read.read_at).toBe('2026-11-11T19:00:00Z');
  });

  it("passes on the collector's reason when it cannot read", async () => {
    reply = { status: 503, body: { message: 'Machine 01-094-292: the controller did not answer within 15s' } };
    await expect(service().read('m1', 'user')).rejects.toThrow('did not answer');
    reply = { status: 404, body: { message: 'No collector worker for this machine: machine is inactive.' } };
    await expect(service().read('m1', 'user')).rejects.toThrow('machine is inactive');
  });

  it('needs a configured machine and a connected Docker collector', async () => {
    await expect(service(false).read('m1', 'user')).rejects.toThrow('Choose a configured');
    writeFileSync(tokenFile, '');
    await expect(service().read('m1', 'user')).rejects.toThrow('Connect Docker collector');
    expect(seen).toHaveLength(0);
  });
});
