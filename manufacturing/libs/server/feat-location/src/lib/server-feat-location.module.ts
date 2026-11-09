import { ServerDataAccessModule } from '@libs/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatLocationController } from './server-feat-location.controller';
import { ServerFeatLocationService } from './server-feat-location.service';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatLocationController],
  providers: [ServerFeatLocationService],
  exports: [ServerFeatLocationService],
})
export class ServerFeatLocationModule {}
