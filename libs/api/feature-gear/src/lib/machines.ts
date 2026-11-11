import { LapperWritePolicy, CrudService, crudController } from '@meshforge/api/core';
import { CreateMachineDto, MachineDto, UpdateMachineDto } from '@meshforge/api/data-access';
import { Machine } from '@meshforge/shared/domain';
import {
  UseInterceptors,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
@Injectable()
export abstract class MachinesService extends CrudService<Machine> {
  abstract findByIp(ip: string, number?: string): Promise<Machine>;
  /** Machines that have at least one recorded cycle for the given gearset. */
  abstract findByGearset(gearsetId: string): Promise<Machine[]>;
}
@UseInterceptors(LapperWritePolicy)
@Controller({ path: 'machine', version: '1' })
@ApiTags('Gear · Machines')
@ApiBearerAuth()
export class MachinesController extends crudController<Machine>({
  entity: MachineDto,
  create: CreateMachineDto,
  update: UpdateMachineDto,
  name: 'machine',
}) {
  constructor(override readonly service: MachinesService) {
    super();
  }
  @Get('ip/:ip')
  @ApiOperation({ summary: 'Find a machine by IP address' })
  @ApiOkResponse({ type: MachineDto })
  findByIp(
    @Param('ip')
    ip: string,
    @Query('number')
    number?: string,
  ): Promise<Machine> {
    return this.service.findByIp(ip, number);
  }
  @Get('gearset/:gearsetId')
  @ApiOperation({ summary: 'Machines that have run a gearset' })
  @ApiOkResponse({ type: MachineDto, isArray: true })
  findByGearset(
    @Param('gearsetId', ParseUUIDPipe)
    gearsetId: string,
  ): Promise<Machine[]> {
    return this.service.findByGearset(gearsetId);
  }
}
