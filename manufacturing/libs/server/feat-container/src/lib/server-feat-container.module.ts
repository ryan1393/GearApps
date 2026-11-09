import { ServerDataAccessModule } from '@libs/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatContainerController } from './server-feat-container.controller';
import { ServerFeatContainerService } from './server-feat-container.service';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatContainerController],
  providers: [ServerFeatContainerService],
  exports: [ServerFeatContainerService],
})
export class ServerFeatContainerModule {}
