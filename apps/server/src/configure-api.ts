import {
  ClassSerializerInterceptor,
  HttpStatus,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { LoggingInterceptor } from '@meshforge/manufacturing/server/util-common';
import { ENV_API_PREFIX } from '@meshforge/manufacturing/shared/util-constants';

/** The HTTP contract used by the sole API entry point and its acceptance tests. */
export function configureApi(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v', defaultVersion: '1' });
  app.getHttpAdapter().getInstance().set('etag', false);
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
  app.setGlobalPrefix(app.get(ConfigService).get<string>(ENV_API_PREFIX) ?? 'api');
  app.enableShutdownHooks();
}
