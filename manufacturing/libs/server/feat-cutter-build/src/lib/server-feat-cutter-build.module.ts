import { ServerDataAccessModule } from '@gearapps/manufacturing/server/data-access';
import { ServerFeatTrayModule } from '@gearapps/manufacturing/server/feat-tray';
import { Module } from '@nestjs/common';

import { CutterCardPrintService } from './cutter-card-print.service';
import { ServerFeatCutterBuildController } from './server-feat-cutter-build.controller';
import { ServerFeatCutterBuildService } from './server-feat-cutter-build.service';
import { WorkflowCancellationController } from './workflow-cancellation.controller';

@Module({
  imports: [ServerDataAccessModule, ServerFeatTrayModule],
  controllers: [ServerFeatCutterBuildController, WorkflowCancellationController],
  providers: [ServerFeatCutterBuildService, CutterCardPrintService],
  exports: [ServerFeatCutterBuildService],
})
export class ServerFeatCutterBuildModule {}
