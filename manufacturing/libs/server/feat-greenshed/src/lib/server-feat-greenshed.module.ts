import { ServerDataAccessModule } from '@gearapps/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatGreenshedController } from './server-feat-greenshed.controller';
import { ServerFeatGreenshedService } from './server-feat-greenshed.service';
import { DsfCountController } from './dsf-count/dsf-count.controller';
import { DsfCountService } from './dsf-count/dsf-count.service';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatGreenshedController, DsfCountController],
  providers: [ServerFeatGreenshedService, DsfCountService],
  exports: [ServerFeatGreenshedService],
})
export class ServerFeatGreenshedModule {}
