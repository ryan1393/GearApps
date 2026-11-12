import {
  setServerErrorReporter,
  warnOnWeakJwtSecrets,
} from '@meshforge/manufacturing/server/util-common';
import {
  ENV_API_PREFIX,
  ENV_ENABLE_SWAGGER,
  ENV_SENTRY_DSN,
  ENV_SERVER_PORT,
} from '@meshforge/manufacturing/shared/util-constants';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { setupSwagger } from './swagger';
import * as Sentry from '@sentry/node';
import { configureApi } from './configure-api';
import { adoptLegacyDatabaseName } from './adopt-legacy-database';
import { applySavedEnvironmentSettings } from './load-saved-settings';

/** Error reporting starts before the application is created, so startup failures are reported too. */
function startErrorReporting(): void {
  const dsn = process.env[ENV_SENTRY_DSN]?.trim();
  if (!dsn) return;
  Sentry.init({ dsn });
  setServerErrorReporter((exception) => Sentry.captureException(exception));
}

async function bootstrap() {
  // A database from before the rename to MeshForge is renamed in place before anything connects.
  await adoptLegacyDatabaseName();
  // Settings saved in Admin > Server Settings join the environment first. The application
  // module validates and reads the environment as it is imported, so it is loaded afterwards.
  await applySavedEnvironmentSettings();
  const { AppModule } = await import(/* webpackMode: "eager" */ './app/app.module');
  // Importing the module loaded .env into the environment, so SENTRY_DSN is known here.
  startErrorReporting();
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  warnOnWeakJwtSecrets();

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

bootstrap().catch(async (error) => {
  Sentry.captureException(error);
  await Sentry.flush(2000).catch(() => false);
  throw error;
});
