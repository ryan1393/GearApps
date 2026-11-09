import {
  ENV_API_PREFIX,
  ENV_API_VERSION,
  ENV_GENERATE_SWAGGER_JSON,
  ENV_SERVER_HOST,
  ENV_SERVER_PORT,
  ENV_SWAGGER_JSON_FILE,
  GEAR_APPS_VERSION,
} from '@gearapps/manufacturing/shared/util-constants';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';

export function setupSwagger(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const documentBuilder = new DocumentBuilder()
    .setTitle('Gear REST API')
    .setVersion(GEAR_APPS_VERSION)
    .addServer('/')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, documentBuilder);
  const documentEndpoint = `${configService.get(
    ENV_API_PREFIX,
  )}/${configService.get(ENV_API_VERSION)}`;
  Logger.debug(`Using documentation endpoint: ${documentEndpoint}`);

  SwaggerModule.setup(documentEndpoint, app, document, {
    jsonDocumentUrl: configService.get(ENV_SWAGGER_JSON_FILE),
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  if (configService.get(ENV_GENERATE_SWAGGER_JSON)) {
    const swaggerJsonFile =
      configService.get(ENV_SWAGGER_JSON_FILE) ?? 'swagger.json';
    fs.writeFileSync(swaggerJsonFile, JSON.stringify(document, null, 2));
  }

  Logger.log(
    `🚀 Swagger API Documentation: http://${configService.get(
      ENV_SERVER_HOST,
    )}:${configService.get(ENV_SERVER_PORT)}/${documentEndpoint}`,
  );
}
