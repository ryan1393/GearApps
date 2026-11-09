import { LoggingInterceptor, warnOnWeakJwtSecrets } from '@gearapps/manufacturing/server/util-common';
import {
  ENV_API_PREFIX,
  ENV_ENABLE_SWAGGER,
  ENV_SERVER_PORT,
} from '@gearapps/manufacturing/shared/util-constants';
import {
  ClassSerializerInterceptor,
  HttpStatus,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';

import { AppModule } from './app/app.module';
import { setupSwagger } from './swagger';
import * as Sentry from '@sentry/node';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  warnOnWeakJwtSecrets();

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });

  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
    defaultVersion: '1',
  });

  // works around 304s
  app.getHttpAdapter().getInstance().set('etag', false);

  const reflector = app.get(Reflector);

  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector),
    new LoggingInterceptor(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      transform: true,
    }),
  );

  const globalPrefix = configService.get(ENV_API_PREFIX);
  app.setGlobalPrefix(globalPrefix);

  const port = configService.get(ENV_SERVER_PORT);

  if (configService.get(ENV_ENABLE_SWAGGER)) {
    setupSwagger(app);
  }

  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}/v1`,
  );
}

bootstrap();
