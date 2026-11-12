import {
  ClassSerializerInterceptor,
  HttpStatus,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import {
  DEFAULT_TRUST_PROXY,
  LoggingInterceptor,
  parseCorsOrigins,
  parseTrustProxy,
} from '@meshforge/manufacturing/server/util-common';
import {
  ENV_API_PREFIX,
  ENV_API_VERSION,
  ENV_CORS_ORIGINS,
} from '@meshforge/manufacturing/shared/util-constants';

/** The Swagger page paths. Only these HTML responses get the relaxed content security policy. */
export function swaggerPagePaths(prefix: string, version: string): Set<string> {
  const base = `/${prefix}/${version}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const last = base.split('/').pop() ?? '';
  return new Set([base, `${base}/`, `${base}/index.html`, `${base}/${last}`, `${base}/${last}/`]);
}

/** Security headers for every response. Swagger UI needs inline styles, scripts and data: images. */
export function securityHeaders(docsPages: ReadonlySet<string>) {
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  return (req: Request, res: Response, next: NextFunction) =>
    (docsPages.has(req.path) ? docs : strict)(req, res, next);
}

/** The HTTP contract used by the sole API entry point and its acceptance tests. */
export function configureApi(app: INestApplication): void {
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance();
  // The client address behind the nginx web clients; used by the sign-in and badge limits.
  express.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY') ?? DEFAULT_TRUST_PROXY) ?? false);
  express.set('etag', false);
  const prefix = config.get<string>(ENV_API_PREFIX) ?? 'api';
  app.use(securityHeaders(swaggerPagePaths(prefix, config.get<string>(ENV_API_VERSION) ?? 'v1')));
  const cors = parseCorsOrigins(config.get<string>(ENV_CORS_ORIGINS));
  if (cors) app.enableCors({ ...cors, exposedHeaders: ['Retry-After'] });
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v', defaultVersion: '1' });
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new LoggingInterceptor(),
  );
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    transform: true,
  }));
  app.setGlobalPrefix(prefix);
  app.enableShutdownHooks();
}
