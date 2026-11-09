import { DataAccessModule } from '@gearapps/api/data-access';
import { Module } from '@nestjs/common';
import {
  CheckCmmsController,
  CheckCmmsService,
  CheckFrequenciesController,
  CheckFrequenciesService,
  CutterBuildsController,
  CutterBuildsService,
  CutterLogsController,
  CutterLogsService,
  PullCutterReasonsController,
  PullCutterReasonsService,
  RetiredCuttersController,
  RetiredCuttersService,
} from './cutter-tracking.controllers';

const services = [
  CutterLogsService,
  PullCutterReasonsService,
  CutterBuildsService,
  CheckCmmsService,
  CheckFrequenciesService,
  RetiredCuttersService,
];

@Module({
  imports: [DataAccessModule],
  controllers: [
    CutterLogsController,
    PullCutterReasonsController,
    CutterBuildsController,
    CheckCmmsController,
    CheckFrequenciesController,
    RetiredCuttersController,
  ],
  providers: services,
  exports: services,
})
export class CutterTrackingModule {}
