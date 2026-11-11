import { CoaterShipmentsController } from './coater-shipments.controller';
import { CoaterShipmentsService } from './coater-shipments.service';
import { CoaterRpaService } from './coater-rpa.service';
import { ServerDataAccessModule } from '@meshforge/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatContainerTrayController } from './server-feat-container-tray.controller';
import { ServerFeatContainerTrayService } from './server-feat-container-tray.service';
@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatContainerTrayController, CoaterShipmentsController],
  providers: [ServerFeatContainerTrayService, CoaterShipmentsService, CoaterRpaService],
  exports: [ServerFeatContainerTrayService],
})
export class ServerFeatContainerTrayModule {}
