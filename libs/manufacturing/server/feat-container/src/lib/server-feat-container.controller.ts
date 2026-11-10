import {
  ApiPageOkResponse,
  InventoryListQueryDto,
  UpdateContainerDto,
  ContainerDto,
  CreateContainerDto,
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

import { ServerFeatContainerService } from './server-feat-container.service';

@Controller({ path: 'containers', version: '1' })
@ApiTags('Containers')
export class ServerFeatContainerController {
  private readonly logger = new Logger(ServerFeatContainerController.name);
  constructor(private containerService: ServerFeatContainerService) { }

  @Post('')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiCreatedResponse({
    type: ContainerDto,
  })
  @Auth([RoleType.ADMIN])
  async createContainer(
    @Body() dto: CreateContainerDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.containerService.createContainer(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiPageOkResponse({ type: ContainerDto })
  async getContainers(@Query() query: InventoryListQueryDto) {
    return this.containerService.getContainers(query);
  }

  @Get('scan/:serialNumber')
  @ApiOkResponse({ type: ContainerDto })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async scanContainer(@Param('serialNumber') serialNumber: string) {
    return this.containerService.getContainerBySerialNumber(serialNumber);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: ContainerDto,
  })
  async getContainer(@Param('id', new ParseUUIDPipe()) containerId: Uuid) {
    return this.containerService.getContainer(containerId);
  }

  @Patch(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: ContainerDto,
  })
  @Auth([RoleType.ADMIN])
  async updateContainer(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateContainerDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating container ${id}`);
    return this.containerService.updateContainer(id, dto, userId);
  }

  @Delete(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: ContainerDto,
  })
  @Auth([RoleType.ADMIN])
  async deleteContainer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqUserId() userId: Uuid,
  ) {
    return this.containerService.deleteContainer(id, userId);
  }
}
