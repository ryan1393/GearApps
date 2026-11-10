import { warnOnWeakJwtSecrets } from '@gearapps/manufacturing/server/util-common';
import {
  ENV_API_PREFIX,
  ENV_ENABLE_SWAGGER,
  ENV_SERVER_PORT,
} from '@gearapps/manufacturing/shared/util-constants';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app/app.module';
import { setupSwagger } from './swagger';
import * as Sentry from '@sentry/node';
import { configureApi } from './configure-api';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  warnOnWeakJwtSecrets();

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });

  configureApi(app);
  const globalPrefix = configService.get(ENV_API_PREFIX);

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
