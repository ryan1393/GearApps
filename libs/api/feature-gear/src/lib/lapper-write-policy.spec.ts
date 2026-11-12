import 'reflect-metadata';
import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ADMIN_ONLY_MESSAGE, COLLECTOR_ONLY_MESSAGE, LapperWritePolicy } from '@meshforge/api/core';
import { GearsetsController, GearsetsService } from './gearsets';
import { MachineCyclesController, MachineCyclesService } from './machine-cycles';
import { MachineFanucVariablesController, MachineFanucVariablesService } from './machine-fanuc-variables';
import { MacroLogsController, MacroLogsService } from './macro-logs';
import { ScannerDetailsController, ScannerDetailsService } from './scanner-details';

/**
 * The Lapper write policy through real Nest routing: which route was matched decides, never the
 * URL text (a query string once made PATCH /scanner-detail/:id look like a serial-number update).
 */
const ID = '0b6f3c56-7c1e-4a0e-9a57-0f9f5d0c1a11';
const ADMIN_ID = '7d0c4b1e-2f7a-4c55-8a0e-3c2b9f1d4e21';
const USERS = {
  user: { id: '5e2a9c3d-1b4f-4e6a-9d8c-7f0a1b2c3d4e', email: 'user@x', role: 'user' },
  admin: { id: ADMIN_ID, email: 'admin@x', role: 'admin' },
  collector: { id: ADMIN_ID, email: 'collector-token:Docker', role: 'user', collectorTokenId: 't1' },
} as const;
type Who = keyof typeof USERS | 'anonymous';

const echo = { create: async (b: unknown) => ({ id: ID, ...(b as object) }), update: async (_id: string, b: unknown) => ({ id: ID, ...(b as object) }) };

@Module({
  controllers: [
    ScannerDetailsController,
    MachineCyclesController,
    MacroLogsController,
    MachineFanucVariablesController,
    GearsetsController,
  ],
  providers: [
    LapperWritePolicy,
    ...[ScannerDetailsService, MachineCyclesService, MacroLogsService, MachineFanucVariablesService, GearsetsService].map(
      (provide) => ({ provide, useValue: echo }),
    ),
  ],
})
class TestModule {}

describe('LapperWritePolicy over HTTP', () => {
  let app: INestApplication;
  let base = '';

  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use((req: { headers: Record<string, string>; user?: unknown }, _res: unknown, next: () => void) => {
      const who = req.headers['x-test-user'] as Who | undefined;
      if (who && who !== 'anonymous') req.user = USERS[who];
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422, transform: true }));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(() => app.close());

  const send = async (who: Who, method: string, path: string, body: unknown = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-user': who },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  const setup = { ip: '10.0.0.9', description: 'moved' };
  const serials = { sn_procces: 'P', sn_queue: null, sn_scanner: 'S' };

  it.each([
    `/api/v1/scanner-detail/${ID}?x=/serial-number/`,
    `/api/v1/scanner-detail/${ID}?x=/serial-numbers`,
    `/api/v1/scanner-detail/${ID}?/serial-numbers`,
  ])('refuses a setup change dressed up as a serial update: PATCH %s', async (path) => {
    for (const who of ['user', 'collector'] as const) {
      const reply = await send(who, 'PATCH', path, setup);
      expect(reply.status).toBe(403);
      expect(reply.body.message).toBe(ADMIN_ONLY_MESSAGE);
    }
    expect((await send('admin', 'PATCH', path, setup)).status).toBe(200);
  });

  it.each([`/api/v1/scanner-detail/${ID}/serial-numbers`, `/api/v1/scanner-detail/serial-number/${ID}`])(
    'lets collector tokens and admins update serials, not user accounts: PATCH %s',
    async (path) => {
      expect((await send('collector', 'PATCH', path, serials)).status).toBe(200);
      expect((await send('admin', 'PATCH', path, serials)).status).toBe(200);
      const user = await send('user', 'PATCH', path, serials);
      expect(user.status).toBe(403);
      expect(user.body.message).toBe(COLLECTOR_ONLY_MESSAGE);
      expect((await send('collector', 'PATCH', path + '?x=1', serials)).status).toBe(200);
    },
  );

  const cycle = { machine_id: ID, gearset_id: ID, serial_number: 'SN', consec: 1, timestamp: '2026-11-09T18:42:13.123Z' };
  const writes: Array<[string, string, unknown]> = [
    ['POST', '/api/v1/machine-cycle', cycle],
    ['POST', '/api/v1/macro-log', { machine_cycle_id: ID, macro_id: ID, value: 1.5 }],
    ['POST', '/api/v1/machine-fanuc-variable', { machine_id: ID, x06_7_frt_dr_closed: false, x01_2_start_cycle: false, y03_2_stack_inCycle: false }],
    ['PATCH', `/api/v1/machine-fanuc-variable/${ID}`, { x06_7_frt_dr_closed: true }],
    ['POST', '/api/v1/gearset', { number: '410', status: 'active', summary_id: null, pinion_id: null, ring_id: null, user_id: null }],
  ];
  it.each(writes)('machine data %s %s: collector tokens and admins only', async (method, path, body) => {
    expect((await send('collector', method, path, body)).status).toBeLessThan(300);
    expect((await send('admin', method, path, body)).status).toBeLessThan(300);
    const user = await send('user', method, path, body);
    expect(user.status).toBe(403);
    expect(user.body.message).toBe(COLLECTOR_ONLY_MESSAGE);
    expect((await send('anonymous', method, path, body)).status).toBe(403);
  });

  it('keeps other writes on the same resources for administrators', async () => {
    const replace = { ...cycle, id: ID };
    for (const who of ['user', 'collector'] as const) {
      expect((await send(who, 'PATCH', `/api/v1/machine-cycle/${ID}`, { consec: 2 })).status).toBe(403);
      expect((await send(who, 'PUT', `/api/v1/machine-cycle/${ID}`, replace)).status).toBe(403);
      expect((await send(who, 'PATCH', `/api/v1/macro-log/${ID}`, { value: 2 })).status).toBe(403);
      expect((await send(who, 'POST', '/api/v1/scanner-detail?x=/serial-number/', { status: 'Active' })).status).toBe(403);
      // A gearset with components is setup data, even from a collector.
      expect((await send(who, 'POST', '/api/v1/gearset', { number: '410', status: 'active', ring_id: ID })).status).toBe(403);
    }
    expect((await send('admin', 'PATCH', `/api/v1/macro-log/${ID}`, { value: 2 })).status).toBe(200);
  });

  it('records who created a gearset', async () => {
    const reply = await send('collector', 'POST', '/api/v1/gearset', { number: '410', status: 'Active', user_id: ID });
    expect(reply.body.user_id).toBe(ADMIN_ID);
  });
});
