import {
  ApiPageOkResponse,
  BladeListQueryDto,
  UpdateBladeDto,
  BladeDto,
  CreateBladeDto,
} from '@gearapps/manufacturing/server/data-access';
import { DepartmentAppEdit, Auth, ReqUserId, UUIDParam } from '@gearapps/manufacturing/server/util-common';
import { RoleType, Uuid } from '@gearapps/manufacturing/shared/util-types';
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ServerFeatBladeService } from './server-feat-blade.service';


@Controller({ path: 'blades', version: '1' })
@ApiTags('Blades')
export class ServerFeatBladeController {
  private readonly logger = new Logger(ServerFeatBladeController.name);
  constructor(private bladeService: ServerFeatBladeService) { }

  @Post('')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiCreatedResponse({
    type: BladeDto,
  })
  @Auth([RoleType.ADMIN])
  async createBlade(
    @Body() dto: CreateBladeDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.bladeService.createBlade(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiPageOkResponse({ type: BladeDto })
  async getBlades(@Query() query: BladeListQueryDto) {
    return this.bladeService.getBlades(query);
  }


  @Get(':id/history')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getBladeHistory(@Param('id', new ParseUUIDPipe()) bladeId: Uuid) {
    return this.bladeService.getBladeHistory(bladeId);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: BladeDto,
  })
  async getBlade(@Param('id', new ParseUUIDPipe()) bladeId: Uuid) {
    return this.bladeService.getBlade(bladeId);
  }

  @Patch(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: BladeDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async updateBlade(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateBladeDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating blade ${id}`);
    return this.bladeService.updateBlade(id, dto, userId);
  }

  @Delete(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: BladeDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async deleteBlade(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.bladeService.deleteBlade(id, userId);
  }
}
