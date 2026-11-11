import { ServerDataAccessModule } from '@meshforge/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatPartSummaryController } from './server-feat-part-summary.controller';
import { ServerFeatPartSummaryService } from './server-feat-part-summary.service';
@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatPartSummaryController],
  providers: [ServerFeatPartSummaryService],
  exports: [ServerFeatPartSummaryService],
})
export class ServerFeatPartSummaryModule {}
