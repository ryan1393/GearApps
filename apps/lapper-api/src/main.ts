import { appConfig } from '@gearapps/api/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const cfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v', defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Same-origin by default (served behind the client's reverse proxy). Extra
  // origins — e.g. the Angular dev server — are opted in via CORS_ORIGINS.
  if (cfg.corsOrigins.length) {
    app.enableCors({ origin: cfg.corsOrigins, credentials: true });
  }

  if (cfg.swaggerEnabled) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('GearApps · Lapper API')
        .setDescription('Gear lapping, cutter tracking and scanner integration')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }

  app.enableShutdownHooks();
  await app.listen(cfg.port, cfg.host);
  logger.log(`Lapper API listening on http://${cfg.host}:${cfg.port}/api/v1 (${cfg.environment})`);
  if (cfg.swaggerEnabled) logger.log(`Swagger UI at http://localhost:${cfg.port}/api/docs`);
}

bootstrap();
