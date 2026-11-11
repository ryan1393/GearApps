import { ServerDataAccessModule } from '@meshforge/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatLocationTrayController } from './server-feat-location-tray.controller';
import { ServerFeatLocationTrayService } from './server-feat-location-tray.service';
@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatLocationTrayController],
  providers: [ServerFeatLocationTrayService],
  exports: [ServerFeatLocationTrayService],
})
export class ServerFeatLocationTrayModule {}
