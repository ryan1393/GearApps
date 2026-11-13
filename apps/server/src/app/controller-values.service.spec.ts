import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARGONAUT_MACROS } from '@meshforge/shared/domain';
import { ControllerValuesService, isPrivateAddress, privateNetworkLookup } from './controller-values.service';

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

  it('sends the collector token only to a local or private-network address', async () => {
    const at = (url: string) =>
      new ControllerValuesService(
        { query: jest.fn(async (sql: string) => (sql.includes('lapper.macros') ? [] : [{ number: '1' }])) } as never,
        { get: () => url } as never,
      ).read('m1', 'user');
    await expect(at('http://203.0.113.5:8080')).rejects.toThrow('the collector token is not sent to 203.0.113.5');
    await expect(at('https://[2001:db8::1]:8080')).rejects.toThrow('the collector token is not sent to 2001:db8::1');
    expect(seen).toHaveLength(0);
    // A name is checked when it is resolved: localhost resolves to loopback.
    reply = { status: 200, body: { values: {} } };
    await at(base.replace('127.0.0.1', 'localhost'));
    expect(seen[0]?.auth).toBe('Bearer glr_docker');
  });

  it('refuses a name that resolves outside the private networks', (done) => {
    const resolve = (_host: string, _options: unknown, callback: (e: null, a: { address: string; family: number }[]) => void) =>
      callback(null, [{ address: '10.0.0.5', family: 4 }, { address: '8.8.8.8', family: 4 }]);
    privateNetworkLookup(resolve as never)('collector.example.com', {}, (error) => {
      expect(error?.message).toContain('collector.example.com resolves to 8.8.8.8');
      privateNetworkLookup(((_h: string, _o: unknown, cb: (e: null, a: unknown[]) => void) => cb(null, [{ address: '172.18.0.4', family: 4 }])) as never)(
        'lapper-read',
        {},
        (ok, address) => {
          expect(ok).toBeNull();
          expect(address).toBe('172.18.0.4');
          done();
        },
      );
    });
  });

  it.each([
    ['127.0.0.1', true], ['10.16.80.68', true], ['172.18.0.4', true], ['192.168.1.2', true], ['169.254.1.1', true],
    ['::1', true], ['fd00::5', true], ['::ffff:10.1.2.3', true],
    ['172.32.0.1', false], ['8.8.8.8', false], ['2001:db8::1', false], ['not-an-ip', false],
  ])('isPrivateAddress(%s) is %s', (address, expected) => expect(isPrivateAddress(address)).toBe(expected));

  it('needs a configured machine and a connected Docker collector', async () => {
    await expect(service(false).read('m1', 'user')).rejects.toThrow('Choose a configured');
    writeFileSync(tokenFile, '');
    await expect(service().read('m1', 'user')).rejects.toThrow('Connect Docker collector');
    expect(seen).toHaveLength(0);
  });
});
