import { AdminMasterDataController } from './admin-master-data.controller';
import { AdminMasterDataService } from './admin-master-data.service';
import { ServerFeatGreenshedModule } from '@gearapps/manufacturing/server/feat-greenshed';
import { ServerFeatCutterBuildModule } from '@gearapps/manufacturing/server/feat-cutter-build';
import { ServerFeatCutterConfigModule } from '@gearapps/manufacturing/server/feat-cutter-config';
import { ServerFeatAuthModule } from '@gearapps/manufacturing/server/feat-auth';
import { ServerFeatBladeModule } from '@gearapps/manufacturing/server/feat-blade';
import { ServerFeatBladeTrayModule } from '@gearapps/manufacturing/server/feat-blade-tray';
import { ServerFeatContainerModule } from '@gearapps/manufacturing/server/feat-container';
import { ServerFeatContainerTrayModule } from '@gearapps/manufacturing/server/feat-container-tray';
import { ServerFeatureHealthModule } from '@gearapps/manufacturing/server/feat-health';
import { ServerFeatLocationModule } from '@gearapps/manufacturing/server/feat-location';
import { ServerFeatLocationTrayModule } from '@gearapps/manufacturing/server/feat-location-tray';
import { ServerFeatPartSummaryModule } from '@gearapps/manufacturing/server/feat-part-summary';
import { ServerFeatTrayModule } from '@gearapps/manufacturing/server/feat-tray';
import { ServerFeatUserModule } from '@gearapps/manufacturing/server/feat-user';
import {
  appConfig,
  dbConfig,
  googleConfig,
  mailerConfig,
  EntityNotFoundFilter,
  QueryFailedFilter,
  TypeormConfigService,
  validationSchema,
} from '@gearapps/manufacturing/server/util-common';
import { ServerUtilMailerModule } from '@gearapps/manufacturing/server/util-mailer';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtAccessTokenGuard } from '@gearapps/manufacturing/server/util-common';
import { PostgresLapperModule } from '@gearapps/api/postgres';
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
  controllers: [AdminMasterDataController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'manufacturing/.env',
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
    { provide: APP_GUARD, useClass: JwtAccessTokenGuard },
    { provide: APP_FILTER, useClass: EntityNotFoundFilter },
    { provide: APP_FILTER, useClass: QueryFailedFilter },
  ],
})
export class AppModule {}
