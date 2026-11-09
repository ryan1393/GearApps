import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CreateMacroLogDto,
  LappingSummaryRowDto,
  MacroLogDto,
  MacroLogEntity,
  UpdateMacroLogDto,
} from '@gearapps/api/data-access';
import { LappingSummaryRow, MACRO_FORMS, MacroLog } from '@gearapps/shared/domain';
import { Controller, Get, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class MacroLogsService extends BaseCrudService<MacroLog> {
  protected override readonly relations = {
    machine_cycle: { machine: true, gearset: true },
    macro: true,
  };

  constructor(@InjectRepository(MacroLogEntity) repo: Repository<MacroLog>) {
    super(repo, 'Macro log');
  }

  /**
   * Latest recorded value of every macro for a machine + gearset, optionally
   * restricted to one form group. Replaces the string-interpolated SQL from the
   * legacy API with a parameterised query that runs on MSSQL and SQLite alike.
   */
  async lappingSummary(
    machineId: string,
    gearsetId: string,
    form?: string,
  ): Promise<LappingSummaryRow[]> {
    const ranked = this.repo
      .createQueryBuilder('ml')
      .innerJoin('ml.machine_cycle', 'mc')
      .innerJoin('ml.macro', 'm')
      .select('ml.id', 'id')
      .addSelect('mc.id', 'machine_cycle_id')
      .addSelect('m.id', 'macro_id')
      .addSelect('m.number', 'number')
      .addSelect('m.name', 'name')
      .addSelect('m.status', 'status')
      .addSelect('m.type', 'type')
      .addSelect('m.tab_index', 'tab_index')
      .addSelect('m.used_form', 'used_form')
      .addSelect('m.l60_table', 'l60_table')
      .addSelect('m.extra', 'extra')
      .addSelect('ml.value', 'value')
      .addSelect('ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY mc.timestamp DESC)', 'rn')
      .where('mc.machine_id = :machineId', { machineId })
      .andWhere('mc.gearset_id = :gearsetId', { gearsetId });

    if (form) ranked.andWhere('m.used_form = :form', { form });

    const rows = await this.repo.manager
      .createQueryBuilder()
      .select('*')
      .from(`(${ranked.getQuery()})`, 'latest')
      .where('latest.rn = 1')
      .orderBy('latest.tab_index', 'ASC')
      .addOrderBy('latest.number', 'ASC')
      .setParameters(ranked.getParameters())
      .getRawMany<LappingSummaryRow & { rn: number }>();

    return rows.map(({ rn: _rn, ...row }) => ({ ...row, value: Number(row.value) }));
  }
}

@Controller({ path: 'macro-log', version: '1' })
@ApiTags('Gear · Macro logs')
@ApiBearerAuth()
export class MacroLogsController extends crudController<MacroLog>({
  entity: MacroLogDto,
  create: CreateMacroLogDto,
  update: UpdateMacroLogDto,
  name: 'macro log',
}) {
  constructor(override readonly service: MacroLogsService) {
    super();
  }

  @Get('summary/:machineId/:gearsetId')
  @ApiOperation({ summary: 'Lapping summary: latest value of each macro for a machine + gearset' })
  @ApiQuery({ name: 'form', required: false, enum: MACRO_FORMS })
  @ApiOkResponse({ type: LappingSummaryRowDto, isArray: true })
  lappingSummary(
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Param('gearsetId', ParseUUIDPipe) gearsetId: string,
    @Query('form') form?: string,
  ): Promise<LappingSummaryRow[]> {
    return this.service.lappingSummary(machineId, gearsetId, form);
  }

  /** Legacy routes kept for compatibility with the original client/collectors. */
  @Get(':machineId/:gearsetId/:form')
  @ApiOperation({
    summary: 'Legacy alias of GET summary/:machineId/:gearsetId?form=',
    deprecated: true,
  })
  @ApiOkResponse({ type: LappingSummaryRowDto, isArray: true })
  legacyByForm(
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Param('gearsetId', ParseUUIDPipe) gearsetId: string,
    @Param('form') form: string,
  ): Promise<LappingSummaryRow[]> {
    return this.service.lappingSummary(machineId, gearsetId, form);
  }

  @Get(':machineId/:gearsetId')
  @ApiOperation({ summary: 'Legacy alias of GET summary/:machineId/:gearsetId', deprecated: true })
  @ApiOkResponse({ type: LappingSummaryRowDto, isArray: true })
  legacyAll(
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Param('gearsetId', ParseUUIDPipe) gearsetId: string,
  ): Promise<LappingSummaryRow[]> {
    return this.service.lappingSummary(machineId, gearsetId);
  }
}
