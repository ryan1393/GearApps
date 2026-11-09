import {
  configLoaders,
  DatabaseExceptionFilter,
  JwtAuthGuard,
  TypeOrmConfigService,
  validationSchema,
} from '@gearapps/api/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { LapperFeaturesModule } from './lapper-features.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/lapper-api/.env'],
      load: configLoaders,
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    TerminusModule,
    LapperFeaturesModule.register(),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
  ],
})
export class AppModule {}
