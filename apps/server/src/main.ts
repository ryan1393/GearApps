import { warnOnWeakJwtSecrets } from '@meshforge/manufacturing/server/util-common';
import {
  ENV_API_PREFIX,
  ENV_ENABLE_SWAGGER,
  ENV_SERVER_PORT,
} from '@meshforge/manufacturing/shared/util-constants';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { setupSwagger } from './swagger';
import * as Sentry from '@sentry/node';
import { configureApi } from './configure-api';
import { applySavedEnvironmentSettings } from './load-saved-settings';

async function bootstrap() {
  // Settings saved in Admin > Server Settings join the environment first. The application
  // module validates and reads the environment as it is imported, so it is loaded afterwards.
  await applySavedEnvironmentSettings();
  const { AppModule } = await import(/* webpackMode: "eager" */ './app/app.module');
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
