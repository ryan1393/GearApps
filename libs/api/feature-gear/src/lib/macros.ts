import { LapperWritePolicy, CrudService, crudController } from '@meshforge/api/core';
import { CreateMacroDto, MacroDto, UpdateMacroDto } from '@meshforge/api/data-access';
import { Macro } from '@meshforge/shared/domain';
import { UseInterceptors, Controller, Get, Injectable, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
@Injectable()
export abstract class MacrosService extends CrudService<Macro> {
  abstract findByType(type: string): Promise<Macro[]>;
  abstract findByForm(usedForm: string): Promise<Macro[]>;
}
@UseInterceptors(LapperWritePolicy)
@Controller({ path: 'macro', version: '1' })
@ApiTags('Gear · Macros')
@ApiBearerAuth()
export class MacrosController extends crudController<Macro>({
  entity: MacroDto,
  create: CreateMacroDto,
  update: UpdateMacroDto,
  name: 'macro',
}) {
  constructor(override readonly service: MacrosService) {
    super();
  }
  @Get('type/:type')
  @ApiOperation({ summary: 'Macros of a given type' })
  @ApiOkResponse({ type: MacroDto, isArray: true })
  findByType(
    @Param('type')
    type: string,
  ): Promise<Macro[]> {
    return this.service.findByType(type);
  }
  @Get('form/:form')
  @ApiOperation({ summary: 'Macros that belong to a lapping-summary form group' })
  @ApiOkResponse({ type: MacroDto, isArray: true })
  findByForm(
    @Param('form')
    form: string,
  ): Promise<Macro[]> {
    return this.service.findByForm(form);
  }
}
