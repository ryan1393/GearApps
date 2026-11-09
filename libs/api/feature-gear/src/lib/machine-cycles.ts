import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CreateMachineCycleDto,
  MachineCycleDto,
  MachineCycleEntity,
  UpdateMachineCycleDto,
} from '@gearapps/api/data-access';
import { MachineCycle } from '@gearapps/shared/domain';
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
export class MachineCyclesService extends BaseCrudService<MachineCycle> {
  protected override readonly relations = { machine: true, gearset: true };
  protected override readonly order = { timestamp: 'DESC' as const };

  constructor(@InjectRepository(MachineCycleEntity) repo: Repository<MachineCycle>) {
    super(repo, 'Machine cycle');
  }

  findByGearset(gearsetId: string): Promise<MachineCycle[]> {
    return this.findAll({ gearset_id: gearsetId });
  }

  findByMachine(machineId: string): Promise<MachineCycle[]> {
    return this.findAll({ machine_id: machineId });
  }

  async findLatest(machineId: string, gearsetId: string): Promise<MachineCycle> {
    const cycle = await this.repo.findOne({
      where: { machine_id: machineId, gearset_id: gearsetId },
      relations: this.relations,
      order: { timestamp: 'DESC' },
    });
    if (!cycle) throw new NotFoundException('No cycles recorded for that machine/gearset');
    return cycle;
  }
}

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
  findByGearset(@Param('gearsetId', ParseUUIDPipe) gearsetId: string): Promise<MachineCycle[]> {
    return this.service.findByGearset(gearsetId);
  }

  @Get('machine/:machineId')
  @ApiOperation({ summary: 'Cycles for a machine (newest first)' })
  @ApiOkResponse({ type: MachineCycleDto, isArray: true })
  findByMachine(@Param('machineId', ParseUUIDPipe) machineId: string): Promise<MachineCycle[]> {
    return this.service.findByMachine(machineId);
  }

  @Get('latest/:machineId/:gearsetId')
  @ApiOperation({ summary: 'Most recent cycle for a machine + gearset' })
  @ApiOkResponse({ type: MachineCycleDto })
  findLatest(
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Param('gearsetId', ParseUUIDPipe) gearsetId: string,
  ): Promise<MachineCycle> {
    return this.service.findLatest(machineId, gearsetId);
  }
}
