import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CreateMachineFanucVariableDto,
  MachineFanucVariableDto,
  MachineFanucVariableEntity,
  UpdateMachineFanucVariableDto,
} from '@gearapps/api/data-access';
import { MachineFanucVariable } from '@gearapps/shared/domain';
import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class MachineFanucVariablesService extends BaseCrudService<MachineFanucVariable> {
  protected override readonly relations = { machine: true };

  constructor(
    @InjectRepository(MachineFanucVariableEntity) repo: Repository<MachineFanucVariable>,
  ) {
    super(repo, 'Machine Fanuc variables');
  }

  async findByMachine(machineId: string): Promise<MachineFanucVariable> {
    const row = await this.repo.findOne({
      where: { machine_id: machineId },
      relations: this.relations,
    });
    if (!row) throw new NotFoundException(`No Fanuc variables recorded for machine ${machineId}`);
    return row;
  }
}

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
    @Param('machineId', ParseUUIDPipe) machineId: string,
  ): Promise<MachineFanucVariable> {
    return this.service.findByMachine(machineId);
  }
}
