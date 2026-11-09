import { Auth } from '@libs/server/util-common';
import { RoleType, Uuid } from '@libs/shared/util-types';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CreateRollMasterDto,
  UpdateRollMasterDto,
} from './roll-master.dto';
import { ServerFeatCutterConfigService } from './server-feat-cutter-config.service';

@Controller({ path: 'roll-masters', version: '1' })
@ApiTags('Roll Masters')
export class ServerRollMastersController {
  constructor(private readonly service: ServerFeatCutterConfigService) {}

  @Get()
  @Auth([RoleType.ADMIN, RoleType.USER])
  listRollMasters(
    @Query('partId') partId?: string,
    @Query('active') active?: string,
    @Query('includeDisabled') includeDisabled?: string,
  ) {
    return this.service.listRollMasters({ partId, active, includeDisabled });
  }

  @Post()
  @Auth([RoleType.ADMIN])
  createRollMaster(@Body() dto: CreateRollMasterDto) {
    return this.service.createRollMaster(dto);
  }

  @Patch(':id')
  @Auth([RoleType.ADMIN])
  updateRollMaster(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateRollMasterDto,
  ) {
    return this.service.updateRollMaster(id, dto);
  }
}
