import { DataAccessModule } from '@gearapps/api/data-access';
import { Module } from '@nestjs/common';
import { GearsetsController, GearsetsService } from './gearsets';
import { MachineCyclesController, MachineCyclesService } from './machine-cycles';
import {
  MachineFanucVariablesController,
  MachineFanucVariablesService,
} from './machine-fanuc-variables';
import { MachinesController, MachinesService } from './machines';
import { MacroLogsController, MacroLogsService } from './macro-logs';
import { MacrosController, MacrosService } from './macros';
import { ScannerDetailsController, ScannerDetailsService } from './scanner-details';
import {
  DepartmentsController,
  DepartmentsService,
  GearsetMarriagesController,
  GearsetMarriagesService,
  PartsController,
  PartsService,
  SummariesController,
  SummariesService,
  TypeOfChecksController,
  TypeOfChecksService,
} from './simple.controllers';

const services = [
  DepartmentsService,
  TypeOfChecksService,
  SummariesService,
  PartsService,
  GearsetsService,
  GearsetMarriagesService,
  ScannerDetailsService,
  MachinesService,
  MachineCyclesService,
  MachineFanucVariablesService,
  MacrosService,
  MacroLogsService,
];

@Module({
  imports: [DataAccessModule],
  controllers: [
    DepartmentsController,
    TypeOfChecksController,
    SummariesController,
    PartsController,
    GearsetsController,
    GearsetMarriagesController,
    ScannerDetailsController,
    MachinesController,
    MachineCyclesController,
    MachineFanucVariablesController,
    MacrosController,
    MacroLogsController,
  ],
  providers: services,
  exports: services,
})
export class GearModule {}
