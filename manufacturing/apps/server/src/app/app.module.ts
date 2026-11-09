import { AdminMasterDataController } from './admin-master-data.controller';
import { AdminMasterDataService } from './admin-master-data.service';
import { ServerFeatGreenshedModule } from '@libs/server/feat-greenshed';
import { ServerFeatCutterBuildModule } from '@libs/server/feat-cutter-build';
import { ServerFeatCutterConfigModule } from '@libs/server/feat-cutter-config';
import { ServerFeatAuthModule } from '@libs/server/feat-auth';
import { ServerFeatBladeModule } from '@libs/server/feat-blade';
import { ServerFeatBladeTrayModule } from '@libs/server/feat-blade-tray';
import { ServerFeatContainerModule } from '@libs/server/feat-container';
import { ServerFeatContainerTrayModule } from '@libs/server/feat-container-tray';
import { ServerFeatureHealthModule } from '@libs/server/feat-health';
import { ServerFeatLocationModule } from '@libs/server/feat-location';
import { ServerFeatLocationTrayModule } from '@libs/server/feat-location-tray';
import { ServerFeatPartSummaryModule } from '@libs/server/feat-part-summary';
import { ServerFeatTrayModule } from '@libs/server/feat-tray';
import { ServerFeatUserModule } from '@libs/server/feat-user';
import {
  appConfig,
  dbConfig,
  googleConfig,
  mailerConfig,
  EntityNotFoundFilter,
  QueryFailedFilter,
  TypeormConfigService,
  validationSchema,
} from '@libs/server/util-common';
import { ServerUtilMailerModule } from '@libs/server/util-mailer';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
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
      envFilePath: '.env',
      load: [appConfig, dbConfig, googleConfig, mailerConfig],
      validationSchema,
    }),
    TypeOrmModule.forRootAsync({ useClass: TypeormConfigService, inject: [ConfigService] }),
    TerminusModule.forRoot(),
    ServerUtilMailerModule,
    ...featureModules,
  ],
  providers: [
    AdminMasterDataService,
    { provide: APP_FILTER, useClass: EntityNotFoundFilter },
    { provide: APP_FILTER, useClass: QueryFailedFilter },
  ],
})
export class AppModule {}
