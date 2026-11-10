import {
  DepartmentsController,
  DepartmentsService,
  GearsetMarriagesController,
  GearsetMarriagesService,
  GearsetsController,
  GearsetsService,
  MachineCyclesController,
  MachineCyclesService,
  MachineFanucVariablesController,
  MachineFanucVariablesService,
  MachinesController,
  MachinesService,
  MacroLogsController,
  MacroLogsService,
  MacrosController,
  MacrosService,
  PartsController,
  PartsService,
  ScannerDetailsController,
  ScannerDetailsService,
  SummariesController,
  SummariesService,
  TypeOfChecksController,
  TypeOfChecksService,
} from '@gearapps/api/feature-gear';
import { ScannerClientService, ScannerController } from '@gearapps/api/feature-scanner';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LapperWritePolicy, scannerConfig } from '@gearapps/api/core';
import { PostgresLapperCatalog } from './catalog';
import { PostgresLapperStore } from './postgres-lapper.store';
import {
  PostgresCrudAdapter,
  PostgresCycles,
  PostgresGearsets,
  PostgresLogs,
  PostgresMachines,
  PostgresMacros,
  PostgresScanners,
  PostgresVariables,
} from './adapters';

@Module({
  imports: [ConfigModule.forFeature(scannerConfig)],
  controllers: [
    DepartmentsController,
    TypeOfChecksController,
    SummariesController,
    PartsController,
    GearsetsController,
    GearsetMarriagesController,
    MachinesController,
    ScannerDetailsController,
    MachineCyclesController,
    MachineFanucVariablesController,
    MacrosController,
    MacroLogsController,
    ScannerController,
  ],
  providers: [
    PostgresLapperCatalog,
    PostgresLapperStore,
    ScannerClientService,
    { provide: MachinesService, useClass: PostgresMachines },
    { provide: GearsetsService, useClass: PostgresGearsets },
    { provide: MachineCyclesService, useClass: PostgresCycles },
    { provide: MacroLogsService, useClass: PostgresLogs },
    { provide: MacrosService, useClass: PostgresMacros },
    { provide: ScannerDetailsService, useClass: PostgresScanners },
    { provide: MachineFanucVariablesService, useClass: PostgresVariables },
    ...(
      [
        [DepartmentsService, 'department'],
        [PartsService, 'part'],
        [SummariesService, 'part-summary'],
        [TypeOfChecksService, 'toc'],
        [GearsetMarriagesService, 'gearset-marriage'],
      ] as const
    ).map(([provide, resource]) => ({
      provide,
      inject: [PostgresLapperStore],
      useFactory: (store: PostgresLapperStore) => new PostgresCrudAdapter(store, resource),
    })),
    LapperWritePolicy,
  ],
})
export class PostgresLapperModule {}
