import { BaseCrudService, crudController } from '@gearapps/api/core';
import { CreateMacroDto, MacroDto, MacroEntity, UpdateMacroDto } from '@gearapps/api/data-access';
import { Macro } from '@gearapps/shared/domain';
import { Controller, Get, Injectable, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class MacrosService extends BaseCrudService<Macro> {
  protected override readonly order = { number: 'ASC' as const };

  constructor(@InjectRepository(MacroEntity) repo: Repository<Macro>) {
    super(repo, 'Macro');
  }

  findByType(type: string): Promise<Macro[]> {
    return this.findAll({ type });
  }

  findByForm(usedForm: string): Promise<Macro[]> {
    return this.findAll({ used_form: usedForm });
  }
}

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
  findByType(@Param('type') type: string): Promise<Macro[]> {
    return this.service.findByType(type);
  }

  @Get('form/:form')
  @ApiOperation({ summary: 'Macros that belong to a lapping-summary form group' })
  @ApiOkResponse({ type: MacroDto, isArray: true })
  findByForm(@Param('form') form: string): Promise<Macro[]> {
    return this.service.findByForm(form);
  }
}
