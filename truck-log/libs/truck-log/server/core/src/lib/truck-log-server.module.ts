import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TruckLogAccessModule } from '@truck-log/server/auth/access';
import { TruckLogAdminModule } from '@truck-log/server/auth/admin';
import { StationAccessModule } from '@truck-log/server/auth/station';
import { DocksModule } from '@truck-log/server/feature/docks';
import { DriverPrintModule } from '@truck-log/server/feature/driver-print';
import { TruckLogHealthModule } from '@truck-log/server/feature/health';
import { PrintAgentsModule } from '@truck-log/server/feature/print-agents';
import { ReferenceDataModule } from '@truck-log/server/feature/reference-data';
import { RxoDocumentsModule } from '@truck-log/server/feature/rxo-documents';
import { RxoExpediteModule } from '@truck-log/server/feature/rxo-expedite';
import { RxoIngestionModule } from '@truck-log/server/feature/rxo-ingestion';
import { ScheduledLoadsModule } from '@truck-log/server/feature/scheduled-loads';
import { AppSettingsModule } from '@truck-log/server/feature/settings';
import { TvDisplaysModule } from '@truck-log/server/feature/tv-displays';
import { TruckVisitsModule } from '@truck-log/server/feature/visits';
import { SapDocumentsModule } from '@truck-log/server/infrastructure/sap-documents';

/**
 * Truck Log server composition root.
 *
 * Keep feature implementation out of this project. Its job is to configure
 * process-wide infrastructure and compose independently owned Nx libraries.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const synchronizeRequested = String(
          config.get('TRUCK_LOG_DATABASE_SYNCHRONIZE', 'false'),
        ).toLowerCase() === 'true';
        if (synchronizeRequested) {
          throw new Error(
            'TRUCK_LOG_DATABASE_SYNCHRONIZE=true is not supported. Use the transactionally verified Truck Log migrations.',
          );
        }
        return {
          type: 'postgres' as const,
          host: config.getOrThrow<string>('TRUCK_LOG_DATABASE_HOST'),
          port: Number(config.getOrThrow<string>('TRUCK_LOG_DATABASE_PORT')),
          username: config.getOrThrow<string>('TRUCK_LOG_DATABASE_USERNAME'),
          password: config.getOrThrow<string>('TRUCK_LOG_DATABASE_PASSWORD'),
          database: config.getOrThrow<string>('TRUCK_LOG_DATABASE_NAME'),
          ssl:
            String(config.get('TRUCK_LOG_DATABASE_SSL', 'false')).toLowerCase() ===
            'true'
              ? { rejectUnauthorized: false }
              : false,
          synchronize: false,
          autoLoadEntities: true,
        };
      },
    }),
    TruckLogAdminModule,
    StationAccessModule,
    TruckLogAccessModule,
    TruckLogHealthModule,
    DocksModule,
    ScheduledLoadsModule,
    TruckVisitsModule,
    DriverPrintModule,
    AppSettingsModule,
    ReferenceDataModule,
    RxoIngestionModule,
    SapDocumentsModule,
    PrintAgentsModule,
    RxoDocumentsModule,
    TvDisplaysModule,
    RxoExpediteModule,
  ],
})
export class TruckLogServerModule {}
