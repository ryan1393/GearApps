import { ServerDataAccessModule } from '@gearapps/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatAssetTagController } from './server-feat-asset-tag.controller';
import { ServerFeatAssetTagService } from './server-feat-asset-tag.service';
import { ServerFeatTrayController } from './server-feat-tray.controller';
import { ServerFeatTrayService } from './server-feat-tray.service';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatTrayController, ServerFeatAssetTagController],
  providers: [ServerFeatTrayService, ServerFeatAssetTagService],
  exports: [ServerFeatTrayService],
})
export class ServerFeatTrayModule {}
