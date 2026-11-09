import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CreateMachineDto,
  MachineCycleEntity,
  MachineDto,
  MachineEntity,
  UpdateMachineDto,
} from '@gearapps/api/data-access';
import { Machine, MachineCycle } from '@gearapps/shared/domain';
import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

@Injectable()
export class MachinesService extends BaseCrudService<Machine> {
  protected override readonly relations = { scanner: true };
  protected override readonly order = { cell: 'ASC' as const, number: 'ASC' as const };

  constructor(
    @InjectRepository(MachineEntity) repo: Repository<Machine>,
    @InjectRepository(MachineCycleEntity) private readonly cycles: Repository<MachineCycle>,
  ) {
    super(repo, 'Machine');
  }

  async findByIp(ip: string, number?: string): Promise<Machine> {
    const machine = await this.repo.findOne({
      where: { ip, ...(number ? { number } : {}) },
      relations: this.relations,
    });
    if (!machine) throw new NotFoundException(`Machine with IP ${ip} not found`);
    return machine;
  }

  /** Machines that have at least one recorded cycle for the given gearset. */
  async findByGearset(gearsetId: string): Promise<Machine[]> {
    const rows = await this.cycles
      .createQueryBuilder('mc')
      .select('mc.machine_id', 'machine_id')
      .distinct(true)
      .where('mc.gearset_id = :gearsetId', { gearsetId })
      .getRawMany<{ machine_id: string }>();
    const ids = rows.map((r) => r.machine_id);
    return ids.length ? this.findAll({ id: In(ids) }) : [];
  }
}

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
  findByIp(@Param('ip') ip: string, @Query('number') number?: string): Promise<Machine> {
    return this.service.findByIp(ip, number);
  }

  @Get('gearset/:gearsetId')
  @ApiOperation({ summary: 'Machines that have run a gearset' })
  @ApiOkResponse({ type: MachineDto, isArray: true })
  findByGearset(@Param('gearsetId', ParseUUIDPipe) gearsetId: string): Promise<Machine[]> {
    return this.service.findByGearset(gearsetId);
  }
}
