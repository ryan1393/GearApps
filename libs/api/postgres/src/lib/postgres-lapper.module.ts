import { jwtConfig } from '@gearapps/api/core';
import {
  AuthController,
  AuthService,
  JwtStrategy,
  UsersController,
  UsersService,
} from '@gearapps/api/feature-auth';
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
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PostgresLapperCatalog } from './catalog';
import { PostgresLapperStore } from './postgres-lapper.store';
import { PostgresUsersService } from './users';
import { PostgresWritePolicy } from './write-policy';
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
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [jwtConfig.KEY],
      useFactory: (jwt: ConfigType<typeof jwtConfig>) => ({
        secret: jwt.secret,
        signOptions: { expiresIn: jwt.expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}` },
      }),
    }),
  ],
  controllers: [
    AuthController,
    UsersController,
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
    AuthService,
    JwtStrategy,
    ScannerClientService,
    { provide: UsersService, useClass: PostgresUsersService },
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
    { provide: APP_INTERCEPTOR, useClass: PostgresWritePolicy },
  ],
})
export class PostgresLapperModule {}
