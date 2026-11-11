import { AdminMasterDataController } from './admin-master-data.controller';
import { AdminMasterDataService } from './admin-master-data.service';
import { EnvironmentSettingsController } from './environment-settings.controller';
import { EnvironmentSettingsService } from './environment-settings.service';
import { ServerFeatGreenshedModule } from '@meshforge/manufacturing/server/feat-greenshed';
import { ServerFeatCutterBuildModule } from '@meshforge/manufacturing/server/feat-cutter-build';
import { ServerFeatCutterConfigModule } from '@meshforge/manufacturing/server/feat-cutter-config';
import { ServerFeatAuthModule } from '@meshforge/manufacturing/server/feat-auth';
import { ServerFeatBladeModule } from '@meshforge/manufacturing/server/feat-blade';
import { ServerFeatBladeTrayModule } from '@meshforge/manufacturing/server/feat-blade-tray';
import { ServerFeatContainerModule } from '@meshforge/manufacturing/server/feat-container';
import { ServerFeatContainerTrayModule } from '@meshforge/manufacturing/server/feat-container-tray';
import { ServerFeatureHealthModule } from '@meshforge/manufacturing/server/feat-health';
import { ServerFeatLocationModule } from '@meshforge/manufacturing/server/feat-location';
import { ServerFeatLocationTrayModule } from '@meshforge/manufacturing/server/feat-location-tray';
import { ServerFeatPartSummaryModule } from '@meshforge/manufacturing/server/feat-part-summary';
import { ServerFeatTrayModule } from '@meshforge/manufacturing/server/feat-tray';
import { ServerFeatUserModule } from '@meshforge/manufacturing/server/feat-user';
import {
  appConfig,
  dbConfig,
  googleConfig,
  mailerConfig,
  EntityNotFoundFilter,
  QueryFailedFilter,
  TypeormConfigService,
  validationSchema,
} from '@meshforge/manufacturing/server/util-common';
import { ServerUtilMailerModule } from '@meshforge/manufacturing/server/util-mailer';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtAccessTokenGuard } from '@meshforge/manufacturing/server/util-common';
import { PostgresLapperModule } from '@meshforge/api/postgres';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';

const featureModules = [
  ServerFeatAuthModule,
  ServerFeatUserModule,
  ServerFeatureHealthModule,
  ServerFeatPartSummaryModule,
  ServerFeatBladeModule,
  ServerFeatTrayModule,
  ServerFeatContainerModule,
  ServerFeatLocationModule,
  ServerFeatBladeTrayModule,
  ServerFeatContainerTrayModule,
  ServerFeatLocationTrayModule,
  ServerFeatCutterConfigModule,
  ServerFeatCutterBuildModule,
  ServerFeatGreenshedModule,
];

@Module({
  controllers: [AdminMasterDataController, EnvironmentSettingsController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, dbConfig, googleConfig, mailerConfig],
      validationSchema,
    }),
    TypeOrmModule.forRootAsync({ useClass: TypeormConfigService, inject: [ConfigService] }),
    TerminusModule.forRoot(),
    ServerUtilMailerModule,
    ...featureModules,
    PostgresLapperModule,
  ],
  providers: [
    AdminMasterDataService,
    EnvironmentSettingsService,
    { provide: APP_GUARD, useClass: JwtAccessTokenGuard },
    { provide: APP_FILTER, useClass: EntityNotFoundFilter },
    { provide: APP_FILTER, useClass: QueryFailedFilter },
  ],
})
export class AppModule {}
