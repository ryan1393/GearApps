import { ServerDataAccessModule } from '@gearapps/manufacturing/server/data-access';
import { Module } from '@nestjs/common';
import { ServerFeatCutterConfigController } from './server-feat-cutter-config.controller';
import { ServerPartTypesController } from './server-part-types.controller';
import { ServerPartsController } from './server-parts.controller';
import { ServerRollMastersController } from './server-roll-masters.controller';
import { ServerFeatCutterConfigService } from './server-feat-cutter-config.service';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatCutterConfigController, ServerPartTypesController, ServerPartsController, ServerRollMastersController],
  providers: [ServerFeatCutterConfigService],
  exports: [ServerFeatCutterConfigService],
})
export class ServerFeatCutterConfigModule {}
