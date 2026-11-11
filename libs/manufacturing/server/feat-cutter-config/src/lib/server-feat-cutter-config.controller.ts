import { Auth, ReqUserId } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateCutterBladeRequirementDto,
  SetSummaryBodyRuleDto,
  UpdateCutterBladeRequirementDto,
  ValidateCutterTrayDto,
} from './cutter-config.dto';
import { ServerFeatCutterConfigService } from './server-feat-cutter-config.service';

@Controller({ path: 'cutter-config', version: '1' })
@ApiTags('Cutter Configuration')
export class ServerFeatCutterConfigController {
  constructor(private readonly service: ServerFeatCutterConfigService) {}

  @Get('part-types')
  @Auth([RoleType.ADMIN, RoleType.USER])
  listPartTypes() {
    return this.service.listPartTypes();
  }

  @Get('blade-requirements')
  @Auth([RoleType.ADMIN, RoleType.USER])
  listRequirements() {
    return this.service.listRequirements();
  }

  @Get('blade-requirements/resolve')
  @Auth([RoleType.ADMIN, RoleType.USER])
  resolveRequirement(
    @Query('summaryId', new ParseUUIDPipe()) summaryId: Uuid,
    @Query('partTypeId', new ParseUUIDPipe()) partTypeId: Uuid,
  ) {
    return this.service.resolveRequirement(summaryId, partTypeId);
  }

  @Post('blade-requirements')
  @Auth([RoleType.ADMIN])
  createRequirement(@Body() dto: CreateCutterBladeRequirementDto) {
    return this.service.createRequirement(dto);
  }

  @Patch('blade-requirements/:id')
  @Auth([RoleType.ADMIN])
  updateRequirement(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateCutterBladeRequirementDto,
  ) {
    return this.service.updateRequirement(id, dto);
  }

  @Delete('blade-requirements/:id')
  @Auth([RoleType.ADMIN])
  disableRequirement(@Param('id', new ParseUUIDPipe()) id: Uuid) {
    return this.service.disableRequirement(id);
  }

  @Get('summary-body-rules')
  @Auth([RoleType.ADMIN, RoleType.USER])
  listSummaryBodyRules() {
    return this.service.listSummaryBodyRules();
  }

  @Put('summary-body-rules/:summaryId')
  @Auth([RoleType.ADMIN])
  setSummaryBodyRule(
    @Param('summaryId', new ParseUUIDPipe()) summaryId: Uuid,
    @Body() dto: SetSummaryBodyRuleDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.setSummaryBodyRule(summaryId, dto.body_rule, userId);
  }

  @Delete('summary-body-rules/:summaryId')
  @Auth([RoleType.ADMIN])
  clearSummaryBodyRule(@Param('summaryId', new ParseUUIDPipe()) summaryId: Uuid) {
    return this.service.clearSummaryBodyRule(summaryId);
  }

  @Post('validate-tray')
  @Auth([RoleType.ADMIN, RoleType.USER])
  validateTray(@Body() dto: ValidateCutterTrayDto) {
    return this.service.validateTray(dto);
  }
}
