import {
  ApiPageOkResponse,
  PaginationOptionsDto,
  UpdateContainerTrayDto,
  ContainerTrayDto,
  CreateContainerTrayDto,
} from '@libs/server/data-access';
import { DepartmentAppEdit, Auth, ReqUserId, UUIDParam } from '@libs/server/util-common';
import { RoleType, Uuid } from '@libs/shared/util-types';
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
import { ServerFeatContainerTrayService } from './server-feat-container-tray.service';
import { UnloadContainerTrayDto } from './unload-container-tray.dto';


@Controller({ path: 'containerTrays', version: '1' })
@ApiTags('ContainerTrays')
export class ServerFeatContainerTrayController {
  private readonly logger = new Logger(ServerFeatContainerTrayController.name);
  constructor(private containerTrayService: ServerFeatContainerTrayService) { }

  @Post('')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiCreatedResponse({
    type: ContainerTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async createContainerTray(
    @Body() dto: CreateContainerTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.containerTrayService.createContainerTray(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN])
  @ApiPageOkResponse({ type: ContainerTrayDto })
  async getContainerTrays(@Query() paginationOptions: PaginationOptionsDto) {
    return this.containerTrayService.getContainerTrays(paginationOptions);
  }

  @Get('container/:containerId/active')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getActiveContainerTrays(
    @Param('containerId', new ParseUUIDPipe()) containerId: Uuid,
  ) {
    return this.containerTrayService.getActiveContainerTrays(containerId);
  }

  @Post('container/:containerId/tray/:trayId/unload')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async unloadTrayFromContainer(
    @Param('containerId', new ParseUUIDPipe()) containerId: Uuid,
    @Param('trayId', new ParseUUIDPipe()) trayId: Uuid,
    @Body() dto: UnloadContainerTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.containerTrayService.unloadTrayFromContainer(
      containerId,
      trayId,
      dto.shelf_location_serial_number,
      userId,
    );
  }


  @Get('tray/:trayId/current')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getCurrentContainerForTray(
    @Param('trayId', new ParseUUIDPipe()) trayId: Uuid,
  ) {
    return this.containerTrayService.getCurrentContainerForTray(trayId);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: ContainerTrayDto,
  })
  async getContainerTray(@Param('id', new ParseUUIDPipe()) containerTrayId: Uuid) {
    return this.containerTrayService.getContainerTray(containerTrayId);
  }

  @Patch(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: ContainerTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async updateContainerTray(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateContainerTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating containerTray ${id}`);
    return this.containerTrayService.updateContainerTray(id, dto, userId);
  }

  @Delete(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: ContainerTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async deleteContainerTray(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.containerTrayService.deleteContainerTray(id, userId);
  }
}
