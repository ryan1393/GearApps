import { ServerDataAccessModule } from '@meshforge/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatGreenshedController } from './server-feat-greenshed.controller';
import { ServerFeatGreenshedService } from './server-feat-greenshed.service';
import { DsfCountController } from './dsf-count/dsf-count.controller';
import { DsfCountService } from './dsf-count/dsf-count.service';
import { DsfHistoryService } from './dsf-count/history/dsf-history.service';
import { DsfHistoryController } from './dsf-count/history/dsf-history.controller';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatGreenshedController, DsfCountController, DsfHistoryController],
  providers: [ServerFeatGreenshedService, DsfHistoryService, DsfCountService],
  exports: [ServerFeatGreenshedService],
})
export class ServerFeatGreenshedModule {}
