import { ServerDataAccessModule } from '@gearapps/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatGreenshedController } from './server-feat-greenshed.controller';
import { ServerFeatGreenshedService } from './server-feat-greenshed.service';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatGreenshedController],
  providers: [ServerFeatGreenshedService],
  exports: [ServerFeatGreenshedService],
})
export class ServerFeatGreenshedModule {}
