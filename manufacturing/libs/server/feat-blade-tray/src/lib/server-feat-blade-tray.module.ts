import { ServerDataAccessModule } from '@libs/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatBladeTrayController } from './server-feat-blade-tray.controller';
import { ServerFeatBladeTrayService } from './server-feat-blade-tray.service';
@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatBladeTrayController],
  providers: [ServerFeatBladeTrayService],
  exports: [ServerFeatBladeTrayService],
})
export class ServerFeatBladeTrayModule {}
