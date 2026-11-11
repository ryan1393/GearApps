import { ARGONAUT_FLOAT_MACROS, argonautAddress, buildArgonautPayload } from '@meshforge/shared/domain';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { ArgonautTestService } from './argonaut-test.service';

describe('Argonaut test transaction', () => {
  it('builds the same request as Lapper Read (apps/lapper-read-py/tests/test_argonaut.py)', () => {
    const values: Record<string, number | null> = Object.fromEntries(ARGONAUT_FLOAT_MACROS.map((n) => [String(n), 1.5]));
    Object.assign(values, { 10020: 373, 10021: 12, 10023: 7.0, 10400: 4, 10480: null, 10063: null });
    const body = buildArgonautPayload('DM2A4C80ZS', 373, 42, values).request;
    expect(body).toMatchObject({ sequence: 42, transactionTypeId: 100, serialNumber: 'DM2A4C80ZS', partNumber: '373', partNumberCode: 0, dintData: [] });
    expect(ARGONAUT_FLOAT_MACROS).toHaveLength(63);
    expect(body.floatData).toHaveLength(64);
    expect(body.floatData[0]).toBe(0);
    expect(body.floatData[1]).toBe(1.5);
    expect(body.floatData[1 + ARGONAUT_FLOAT_MACROS.indexOf(10063)]).toBe(0);
    expect(body.stringData).toEqual(['373', '12', '7', '4', '0']);
  });

  it('adds the location ID only when the address has none', () => {
    expect(argonautAddress('https://argo:3003/api/mes/trigger-transaction', 'LOC 1')).toBe('https://argo:3003/api/mes/trigger-transaction?locationId=LOC+1');
    expect(argonautAddress('https://argo/t?LocationId=A', 'B')).toBe('https://argo/t?LocationId=A');
    expect(argonautAddress('http://argo/t?x=1', 'B')).toBe('http://argo/t?x=1&locationId=B');
    expect(() => argonautAddress('ftp://argo/t')).toThrow('http');
  });

  const service = (machine: object | undefined, gearset: object | undefined, env: Record<string, unknown> = {}) => {
    const query = jest.fn(async (sql: string) => (sql.includes('lapper.machines') ? (machine ? [machine] : []) : gearset ? [gearset] : []));
    const config = { get: (key: string) => env[key] };
    return new ArgonautTestService({ query } as never, config as never);
  };
  const input = { machine_id: 'm', gearset_id: 'g', serial_number: ' DD1A6BB0T6 ', sequence: 3, values: { 10039: 2.25 } };

  it("uses the machine's address, the gearset as part number and #10020, and the configured transaction type", async () => {
    const { url, payload } = await service(
      { argonaut_url: 'https://argo/api/mes/trigger-transaction', argonaut_location_id: 'machine-loc' },
      { number: '10006253' },
      { LAPPER_READ_ARGONAUT_TRANSACTION_TYPE_ID: 101, LAPPER_READ_ARGONAUT_LOCATION_ID: 'env-loc' },
    ).prepare(input);
    expect(url).toBe('https://argo/api/mes/trigger-transaction?locationId=machine-loc');
    expect(payload.request).toMatchObject({ serialNumber: 'DD1A6BB0T6', partNumber: '10006253', sequence: 3, transactionTypeId: 101 });
    expect(payload.request.floatData[1]).toBe(2.25);
    expect(payload.request.stringData[0]).toBe('10006253');
  });

  it('lets the test override the address and location, and falls back to the .env address', async () => {
    const env = { LAPPER_READ_ARGONAUT_URL: 'https://env-argo/t', LAPPER_READ_ARGONAUT_LOCATION_ID: 'env-loc' };
    expect((await service({}, { number: '1' }, env).prepare(input)).url).toBe('https://env-argo/t?locationId=env-loc');
    const custom = await service({ argonaut_url: 'https://argo/t' }, { number: '1' }, env).prepare({ ...input, url: 'https://spearhead/t', location_id: 'test' });
    expect(custom.url).toBe('https://spearhead/t?locationId=test');
  });

  it("serves Lapper Read the saved settings, signing in as the original collector when none is set", () => {
    expect(service({}, {}, { LAPPER_READ_ARGONAUT_URL: ' https://argo/x ', LAPPER_READ_ARGONAUT_VERIFY_TLS: false }).collectorSettings())
      .toEqual({ url: 'https://argo/x', location_id: '', username: 'user', password: 'pw', transaction_type_id: 100, verify_tls: false });
    expect(service({}, {}, { LAPPER_READ_ARGONAUT_USERNAME: 'mes', LAPPER_READ_ARGONAUT_PASSWORD: 's' }).collectorSettings())
      .toMatchObject({ username: 'mes', password: 's', verify_tls: true });
  });

  it('refuses without an address, an unknown machine or a non-numeric value', async () => {
    await expect(service({}, { number: '1' }).prepare(input)).rejects.toThrow('No Argonaut address');
    await expect(service(undefined, { number: '1' }).prepare(input)).rejects.toThrow('Choose a configured');
    await expect(service({}, { number: '1' }).prepare({ ...input, values: { 10039: 'x' as never } })).rejects.toThrow('#10039');
  });

  it('posts the request with Basic sign-in and reports what Argonaut answered', async () => {
    const received: { body: string; auth?: string; url?: string }[] = [];
    let status = 200;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ body, auth: req.headers.authorization, url: req.url });
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(status === 200 ? '{"success":true}' : 'bad serial');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const argo = service({ argonaut_url: `http://127.0.0.1:${port}/api/mes/trigger-transaction` }, { number: '373' }, {
        LAPPER_READ_ARGONAUT_USERNAME: 'argo', LAPPER_READ_ARGONAUT_PASSWORD: 'p@ss', LAPPER_READ_ARGONAUT_LOCATION_ID: 'L1',
      });
      const ok = await argo.send(input, 'user');
      expect(ok).toMatchObject({ ok: true, status: 200, response: '{"success":true}' });
      expect(received[0].url).toBe('/api/mes/trigger-transaction?locationId=L1');
      expect(received[0].auth).toBe('Basic ' + Buffer.from('argo:p@ss').toString('base64'));
      expect(JSON.parse(received[0].body)).toEqual(ok.payload);
      status = 400;
      expect(await argo.send(input, 'user')).toMatchObject({ ok: false, status: 400, response: 'bad serial' });
      // No user or password configured: sign in as the original C# Lapper Read did.
      status = 200;
      await service({ argonaut_url: `http://127.0.0.1:${port}/t` }, { number: '1' }).send(input, 'user');
      expect(received[2].auth).toBe('Basic dXNlcjpwdw==');
    } finally {
      server.close();
    }
    const down = await service({ argonaut_url: `http://127.0.0.1:${port}/t` }, { number: '1' }).send(input, 'user');
    expect(down).toMatchObject({ ok: false, status: null });
    expect(down.message).toContain('unreachable');
  });
});
