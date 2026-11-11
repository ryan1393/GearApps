import {
  CollectorTokensController,
  CollectorTokensService,
  DepartmentsController,
  DepartmentsService,
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
} from '@meshforge/api/feature-gear';
import { ScannerClientService, ScannerController } from '@meshforge/api/feature-scanner';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LapperWritePolicy, scannerConfig } from '@meshforge/api/core';
import { PostgresLapperCatalog } from './catalog';
import { PostgresCollectorTokens } from './collector-tokens';
import { COLLECTOR_TOKEN_RESOLVER } from '@meshforge/shared/domain';
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
    SummariesController,
    PartsController,
    GearsetsController,
    MachinesController,
    ScannerDetailsController,
    MachineCyclesController,
    MachineFanucVariablesController,
    MacrosController,
    MacroLogsController,
    ScannerController,
    CollectorTokensController,
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
      ] as const
    ).map(([provide, resource]) => ({
      provide,
      inject: [PostgresLapperStore],
      useFactory: (store: PostgresLapperStore) => new PostgresCrudAdapter(store, resource),
    })),
    LapperWritePolicy,
    PostgresCollectorTokens,
    { provide: CollectorTokensService, useExisting: PostgresCollectorTokens },
    // Read by the global access guard to accept collector tokens.
    { provide: COLLECTOR_TOKEN_RESOLVER, useExisting: PostgresCollectorTokens },
  ],
  exports: [COLLECTOR_TOKEN_RESOLVER],
})
export class PostgresLapperModule {}
