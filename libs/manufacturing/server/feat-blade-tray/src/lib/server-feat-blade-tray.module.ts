import { ServerDataAccessModule } from '@meshforge/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatBladeTrayController } from './server-feat-blade-tray.controller';
import { ServerFeatBladeTrayService } from './server-feat-blade-tray.service';
import { OpeningInventoryService } from './opening-inventory.service';
@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatBladeTrayController],
  providers: [ServerFeatBladeTrayService, OpeningInventoryService],
  exports: [ServerFeatBladeTrayService],
})
export class ServerFeatBladeTrayModule {}
