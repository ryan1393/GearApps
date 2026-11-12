import { BadRequestException, Controller, Get, INestApplication, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { AddressInfo } from 'node:net';
import { EntityNotFoundError } from 'typeorm';
import {
  EntityNotFoundFilter,
  QueryFailedFilter,
  ReportServerErrorsFilter,
  setServerErrorReporter,
} from '@meshforge/manufacturing/server/util-common';

import { configureApi, swaggerPagePaths } from './configure-api';

@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get('ip') ip(@Req() req: Request) {
    return { ip: req.ip };
  }
  @Get('missing') missing() {
    throw new EntityNotFoundError('Thing', {});
  }
  @Get('bad') bad() {
    throw new BadRequestException('Nope');
  }
  @Get('broken') broken() {
    throw new Error('internal detail');
  }
}

async function start(settings: Record<string, string>): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [
      { provide: ConfigService, useValue: new ConfigService({ API_PREFIX: 'api', API_VERSION: 'v1', ...settings }) },
      { provide: APP_FILTER, useClass: ReportServerErrorsFilter },
      { provide: APP_FILTER, useClass: EntityNotFoundFilter },
      { provide: APP_FILTER, useClass: QueryFailedFilter },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  configureApi(app);
  await app.listen(0, '127.0.0.1');
  return app;
}

async function get(app: INestApplication, path: string, headers: Record<string, string> = {}) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await response.text();
  return {
    status: response.status,
    headers: new Proxy({} as Record<string, string | undefined>, {
      get: (_target, name: string) => response.headers.get(name) ?? undefined,
    }),
    body: text ? JSON.parse(text) : undefined,
  };
}

describe('configureApi', () => {
  let app: INestApplication;
  const reported: unknown[] = [];
  beforeAll(() => setServerErrorReporter((error) => reported.push(error)));
  afterAll(() => setServerErrorReporter(null));
  afterEach(async () => {
    reported.length = 0;
    await app?.close();
  });

  it('sends security headers and allows any origin without credentials for *', async () => {
    app = await start({ CORS_ORIGINS: '*' });
    const response = await get(app, '/api/v1/probe/ip', { 'Origin': 'http://elsewhere' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('allows only the listed origins', async () => {
    app = await start({ CORS_ORIGINS: 'http://server:4200' });
    const allowed = await get(app, '/api/v1/probe/ip', { 'Origin': 'http://server:4200' });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://server:4200');
    const other = await get(app, '/api/v1/probe/ip', { 'Origin': 'http://evil:4200' });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('takes the client address from a trusted local proxy', async () => {
    app = await start({ TRUST_PROXY: 'loopback, uniquelocal' });
    const response = await get(app, '/api/v1/probe/ip', { 'X-Forwarded-For': '203.0.113.9' });
    expect(response.body.ip).toBe('203.0.113.9');
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    app = await start({ TRUST_PROXY: 'false' });
    const response = await get(app, '/api/v1/probe/ip', { 'X-Forwarded-For': '203.0.113.9' });
    expect(response.body.ip).not.toBe('203.0.113.9');
  });

  it('keeps the specific error responses and reports only server errors', async () => {
    app = await start({});
    const missing = await get(app, '/api/v1/probe/missing');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('The requested record could not be found');
    const bad = await get(app, '/api/v1/probe/bad');
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Nope');
    expect(reported).toHaveLength(0);
    const broken = await get(app, '/api/v1/probe/broken');
    expect(broken.status).toBe(500);
    expect(broken.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(reported).toHaveLength(1);
  });

  it('lists the Swagger page paths only', () => {
    const pages = swaggerPagePaths('api', 'v1');
    expect(pages.has('/api/v1')).toBe(true);
    expect(pages.has('/api/v1/')).toBe(true);
    expect(pages.has('/api/v1/users')).toBe(false);
  });
});
