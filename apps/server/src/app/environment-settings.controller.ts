import { Auth, ReqUserId } from '@gearapps/manufacturing/server/util-common';
import { RoleType, Uuid } from '@gearapps/manufacturing/shared/util-types';
import { Body, Controller, Get, Header, HttpCode, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SaveEnvironmentSettingsDto } from './environment-settings.dto';
import { EnvironmentSettingsService } from './environment-settings.service';

/** Admin > Server Settings: the server environment settings, and the values saved over them. */
@Controller({ path: 'admin/environment-settings', version: '1' })
@ApiTags('Admin Server Settings')
export class EnvironmentSettingsController {
  constructor(private readonly settings: EnvironmentSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN])
  board() {
    return this.settings.board();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN])
  save(@Body() dto: SaveEnvironmentSettingsDto, @ReqUserId() userId: Uuid) {
    return this.settings.save(dto.changes, userId);
  }

  @Post('restart')
  @HttpCode(202)
  @Auth([RoleType.ADMIN])
  restart(@ReqUserId() userId: Uuid) {
    return this.settings.restart(userId);
  }
}
