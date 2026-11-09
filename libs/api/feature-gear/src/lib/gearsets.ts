import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CreateGearsetDto,
  GearsetDto,
  GearsetEntity,
  MachineCycleEntity,
  UpdateGearsetDto,
} from '@gearapps/api/data-access';
import { Gearset, MachineCycle } from '@gearapps/shared/domain';
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
import { In, Repository } from 'typeorm';

@Injectable()
export class GearsetsService extends BaseCrudService<Gearset> {
  protected override readonly relations = { user: true, ring: true, pinion: true, summary: true };
  protected override readonly order = { number: 'ASC' as const };

  constructor(
    @InjectRepository(GearsetEntity) repo: Repository<Gearset>,
    @InjectRepository(MachineCycleEntity) private readonly cycles: Repository<MachineCycle>,
  ) {
    super(repo, 'Gearset');
  }

  async findByNumber(number: string): Promise<Gearset> {
    const gearset = await this.repo.findOne({ where: { number }, relations: this.relations });
    if (!gearset) throw new NotFoundException(`Gearset ${number} not found`);
    return gearset;
  }

  /** Gearsets that have at least one recorded cycle on the given machine. */
  async findByMachine(machineId: string): Promise<Gearset[]> {
    const rows = await this.cycles
      .createQueryBuilder('mc')
      .select('mc.gearset_id', 'gearset_id')
      .distinct(true)
      .where('mc.machine_id = :machineId', { machineId })
      .getRawMany<{ gearset_id: string }>();
    const ids = rows.map((r) => r.gearset_id);
    return ids.length ? this.findAll({ id: In(ids) }) : [];
  }
}

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
  findByNumber(@Param('number') number: string): Promise<Gearset> {
    return this.service.findByNumber(number);
  }

  @Get('machine/:machineId')
  @ApiOperation({ summary: 'Gearsets that have run on a machine' })
  @ApiOkResponse({ type: GearsetDto, isArray: true })
  findByMachine(@Param('machineId', ParseUUIDPipe) machineId: string): Promise<Gearset[]> {
    return this.service.findByMachine(machineId);
  }
}
