import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = (process.env.TRUCK_LOG_CORS_ORIGINS ?? 'http://localhost:4300')
    .split(',').map((v) => v.trim()).filter(Boolean);

  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = Number(process.env.TRUCK_LOG_API_PORT ?? 3334);
  await app.listen(port, '0.0.0.0');
  console.log(`Truck Log API listening on http://0.0.0.0:${port}/api/v1`);
}
bootstrap().catch((error) => {
  console.error('Truck Log API startup failed:', error);
  process.exit(1);
});
