import { LapperWritePolicy, CrudService, crudController } from '@gearapps/api/core';
import {
  CreateMacroLogDto,
  LappingSummaryRowDto,
  MacroLogDto,
  UpdateMacroLogDto,
} from '@gearapps/api/data-access';
import { LappingSummaryRow, MACRO_FORMS, MacroLog } from '@gearapps/shared/domain';
import {
  UseInterceptors,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
@Injectable()
export abstract class MacroLogsService extends CrudService<MacroLog> {
  /**
   * Latest recorded value of every macro for a machine + gearset, optionally
   * restricted to one form group. Replaces the string-interpolated SQL from the
   * legacy API with a parameterised query that runs on MSSQL and SQLite alike.
   */
  abstract lappingSummary(
    machineId: string,
    gearsetId: string,
    form?: string,
  ): Promise<LappingSummaryRow[]>;
}
@UseInterceptors(LapperWritePolicy)
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
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
    @Param('gearsetId', ParseUUIDPipe)
    gearsetId: string,
    @Query('form')
    form?: string,
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
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
    @Param('gearsetId', ParseUUIDPipe)
    gearsetId: string,
    @Param('form')
    form: string,
  ): Promise<LappingSummaryRow[]> {
    return this.service.lappingSummary(machineId, gearsetId, form);
  }
  @Get(':machineId/:gearsetId')
  @ApiOperation({ summary: 'Legacy alias of GET summary/:machineId/:gearsetId', deprecated: true })
  @ApiOkResponse({ type: LappingSummaryRowDto, isArray: true })
  legacyAll(
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
    @Param('gearsetId', ParseUUIDPipe)
    gearsetId: string,
  ): Promise<LappingSummaryRow[]> {
    return this.service.lappingSummary(machineId, gearsetId);
  }
}
