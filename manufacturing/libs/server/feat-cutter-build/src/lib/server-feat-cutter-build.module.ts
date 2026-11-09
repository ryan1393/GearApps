import { ServerDataAccessModule } from '@gearapps/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { ServerFeatCutterBuildController } from './server-feat-cutter-build.controller';
import { ServerFeatCutterBuildService } from './server-feat-cutter-build.service';
import { WorkflowCancellationController } from './workflow-cancellation.controller';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatCutterBuildController, WorkflowCancellationController],
  providers: [ServerFeatCutterBuildService],
  exports: [ServerFeatCutterBuildService],
})
export class ServerFeatCutterBuildModule {}
