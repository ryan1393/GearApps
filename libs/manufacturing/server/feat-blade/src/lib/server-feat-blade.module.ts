import { ServerDataAccessModule } from '@meshforge/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatBladeController } from './server-feat-blade.controller';
import { ServerFeatBladeService } from './server-feat-blade.service';
@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatBladeController],
  providers: [ServerFeatBladeService],
  exports: [ServerFeatBladeService],
})
export class ServerFeatBladeModule {}
