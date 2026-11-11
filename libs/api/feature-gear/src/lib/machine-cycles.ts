import { LapperWritePolicy, CrudService, crudController } from '@meshforge/api/core';
import {
  CreateMachineCycleDto,
  MachineCycleDto,
  UpdateMachineCycleDto,
} from '@meshforge/api/data-access';
import { MachineCycle } from '@meshforge/shared/domain';
import { UseInterceptors, Controller, Get, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
@Injectable()
export abstract class MachineCyclesService extends CrudService<MachineCycle> {
  abstract findByGearset(gearsetId: string): Promise<MachineCycle[]>;
  abstract findByMachine(machineId: string): Promise<MachineCycle[]>;
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
  @ApiOperation({ summary: 'Cycles for a machine (newest first)' })
  @ApiOkResponse({ type: MachineCycleDto, isArray: true })
  findByMachine(
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
  ): Promise<MachineCycle[]> {
    return this.service.findByMachine(machineId);
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
