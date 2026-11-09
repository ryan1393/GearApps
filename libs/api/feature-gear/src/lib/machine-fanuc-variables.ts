import { LapperWritePolicy, CrudService, crudController } from '@gearapps/api/core';
import {
  CreateMachineFanucVariableDto,
  MachineFanucVariableDto,
  UpdateMachineFanucVariableDto,
} from '@gearapps/api/data-access';
import { MachineFanucVariable } from '@gearapps/shared/domain';
import { UseInterceptors, Controller, Get, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
@Injectable()
export abstract class MachineFanucVariablesService extends CrudService<MachineFanucVariable> {
  abstract findByMachine(machineId: string): Promise<MachineFanucVariable>;
}
@UseInterceptors(LapperWritePolicy)
@Controller({ path: 'machine-fanuc-variable', version: '1' })
@ApiTags('Gear · Machine Fanuc variables')
@ApiBearerAuth()
export class MachineFanucVariablesController extends crudController<MachineFanucVariable>({
  entity: MachineFanucVariableDto,
  create: CreateMachineFanucVariableDto,
  update: UpdateMachineFanucVariableDto,
  name: 'Fanuc variable set',
}) {
  constructor(override readonly service: MachineFanucVariablesService) {
    super();
  }
  @Get('by-machine/:machineId')
  @ApiOperation({ summary: 'Live I/O snapshot for a machine' })
  @ApiOkResponse({ type: MachineFanucVariableDto })
  findByMachine(
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
  ): Promise<MachineFanucVariable> {
    return this.service.findByMachine(machineId);
  }
}
