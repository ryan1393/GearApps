import { LapperWritePolicy, CrudService, crudController } from '@meshforge/api/core';
import { CreateGearsetDto, GearsetDto, UpdateGearsetDto } from '@meshforge/api/data-access';
import { Gearset } from '@meshforge/shared/domain';
import { UseInterceptors, Controller, Get, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
@Injectable()
export abstract class GearsetsService extends CrudService<Gearset> {
  abstract findByNumber(number: string): Promise<Gearset>;
  /** Gearsets that have at least one recorded cycle on the given machine. */
  abstract findByMachine(machineId: string): Promise<Gearset[]>;
}
@UseInterceptors(LapperWritePolicy)
@Controller({ path: 'gearset', version: '1' })
@ApiTags('Gear · Gearsets')
@ApiBearerAuth()
export class GearsetsController extends crudController<Gearset>({
  entity: GearsetDto,
  create: CreateGearsetDto,
  update: UpdateGearsetDto,
  name: 'gearset',
}) {
  constructor(override readonly service: GearsetsService) {
    super();
  }
  @Get('number/:number')
  @ApiOperation({ summary: 'Find a gearset by its number' })
  @ApiOkResponse({ type: GearsetDto })
  findByNumber(
    @Param('number')
    number: string,
  ): Promise<Gearset> {
    return this.service.findByNumber(number);
  }
  @Get('machine/:machineId')
  @ApiOperation({ summary: 'Gearsets that have run on a machine' })
  @ApiOkResponse({ type: GearsetDto, isArray: true })
  findByMachine(
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
  ): Promise<Gearset[]> {
    return this.service.findByMachine(machineId);
  }
}
