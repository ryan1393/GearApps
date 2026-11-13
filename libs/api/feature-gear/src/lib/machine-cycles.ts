import { LapperWritePolicy, CrudService, crudController, LIST_PAGE_MAX, listPage } from '@meshforge/api/core';
import {
  CreateMachineCycleDto,
  MachineCycleDto,
  UpdateMachineCycleDto,
} from '@meshforge/api/data-access';
import { CycleHistoryPage, LapperProduction, MachineCycle, SETTING_CHANGE_HOURS, SettingChanges } from '@meshforge/shared/domain';
import { BadRequestException, UseInterceptors, Controller, Get, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
/** The most cycles `GET machine-cycle/machine/:id?limit=` returns. */
export const RECENT_CYCLES_MAX = 200;
@Injectable()
export abstract class MachineCyclesService extends CrudService<MachineCycle> {
  /** One page of every cycle, newest first. */
  abstract findPage(page: number, pageSize: number): Promise<MachineCycle[]>;
  abstract findByGearset(gearsetId: string): Promise<MachineCycle[]>;
  /** Newest first; `limit` keeps only that many (every cycle without it). */
  abstract findByMachine(machineId: string, limit?: number): Promise<MachineCycle[]>;
  abstract production(): Promise<LapperProduction>;
  abstract settingChanges(hours: number, limit: number): Promise<SettingChanges>;
  abstract history(machineId: string, gearsetId: string): Promise<MachineCycle[]>;
  abstract historyPage(machineId: string, gearsetId: string, page: number, pageSize: number, serial?: string): Promise<CycleHistoryPage>;
  abstract findLatest(machineId: string, gearsetId: string): Promise<MachineCycle>;
}
@UseInterceptors(LapperWritePolicy)
@Controller({ path: 'machine-cycle', version: '1' })
@ApiTags('Gear · Machine cycles')
@ApiBearerAuth()
export class MachineCyclesController extends crudController<MachineCycle>({
  entity: MachineCycleDto,
  create: CreateMachineCycleDto,
  update: UpdateMachineCycleDto,
  name: 'machine cycle',
}) {
  constructor(override readonly service: MachineCyclesService) {
    super();
  }
  @Get()
  @ApiOperation({
    summary: `Machine cycles, newest first: the newest ${LIST_PAGE_MAX} unless paged with page and pageSize`,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'From 1 (default 1)' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: `1 to ${LIST_PAGE_MAX} (default ${LIST_PAGE_MAX})` })
  @ApiOkResponse({ type: MachineCycleDto, isArray: true })
  override findAll(@Query('page') page?: string, @Query('pageSize') pageSize?: string): Promise<MachineCycle[]> {
    const wanted = listPage(page, pageSize);
    return this.service.findPage(wanted.page, wanted.pageSize);
  }
  @Get('production')
  @ApiOperation({ summary: 'Production totals over the past 24 hours, excluding simulations' })
  production(): Promise<LapperProduction> { return this.service.production(); }
  @Get('setting-changes')
  @ApiOperation({
    summary: 'Cycles that changed a value other than the consec counter since the previous cycle of the same machine and gearset',
  })
  settingChanges(@Query('hours') hours?: string, @Query('limit') limit?: string): Promise<SettingChanges> {
    const whole = (value: string | undefined, fallback: number, max: number) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
    };
    return this.service.settingChanges(whole(hours, SETTING_CHANGE_HOURS, 168), whole(limit, 100, 500));
  }
  @Get('gearset/:gearsetId')
  @ApiOperation({ summary: 'Cycles for a gearset (newest first)' })
  @ApiOkResponse({ type: MachineCycleDto, isArray: true })
  findByGearset(
    @Param('gearsetId', ParseUUIDPipe)
    gearsetId: string,
  ): Promise<MachineCycle[]> {
    return this.service.findByGearset(gearsetId);
  }
  @Get('machine/:machineId')
  @ApiOperation({ summary: 'Cycles for a machine (newest first); limit keeps only the newest few' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: `1 to ${RECENT_CYCLES_MAX}; every cycle when omitted` })
  @ApiOkResponse({ type: MachineCycleDto, isArray: true })
  findByMachine(
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
    @Query('limit') limit?: string,
  ): Promise<MachineCycle[]> {
    if (limit === undefined || limit === '') return this.service.findByMachine(machineId);
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException('limit must be a whole number from 1');
    return this.service.findByMachine(machineId, Math.min(parsed, RECENT_CYCLES_MAX));
  }
  @Get('history/:machineId/:gearsetId')
  @ApiOperation({ summary: 'Most recent 200 cycles for a machine and gearset' })
  @ApiOkResponse({ type: MachineCycleDto, isArray: true })
  history(@Param('machineId', ParseUUIDPipe) machineId: string,
    @Param('gearsetId', ParseUUIDPipe) gearsetId: string): Promise<MachineCycle[]> {
    return this.service.history(machineId, gearsetId);
  }
  @Get('history-page/:machineId/:gearsetId')
  @ApiOperation({ summary: 'One page of the cycles for a machine and gearset, newest first' })
  historyPage(@Param('machineId', ParseUUIDPipe) machineId: string,
    @Param('gearsetId', ParseUUIDPipe) gearsetId: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('serial') serial?: string): Promise<CycleHistoryPage> {
    const whole = (value: string | undefined, fallback: number, max: number) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
    };
    return this.service.historyPage(machineId, gearsetId, whole(page, 1, 1_000_000), whole(pageSize, 15, 100), serial?.slice(0, 160));
  }
  @Get('latest/:machineId/:gearsetId')
  @ApiOperation({ summary: 'Most recent cycle for a machine + gearset' })
  @ApiOkResponse({ type: MachineCycleDto })
  findLatest(
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
    @Param('gearsetId', ParseUUIDPipe)
    gearsetId: string,
  ): Promise<MachineCycle> {
    return this.service.findLatest(machineId, gearsetId);
  }
}
