import {
  ApiPageOkResponse,
  CreateLocationDto,
  LocationDto,
  InventoryListQueryDto,
  UpdateLocationDto,
} from '@gearapps/manufacturing/server/data-access';
import { DepartmentAppEdit, Auth, ReqUserId } from '@gearapps/manufacturing/server/util-common';
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

import { ServerFeatLocationService } from './server-feat-location.service';

@Controller({ path: 'locations', version: '1' })
@ApiTags('Locations')
export class ServerFeatLocationController {
  private readonly logger = new Logger(ServerFeatLocationController.name);
  constructor(private locationService: ServerFeatLocationService) { }

  @Post('')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiCreatedResponse({
    type: LocationDto,
  })
  @Auth([RoleType.ADMIN])
  async createLocation(
    @Body() dto: CreateLocationDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.locationService.createLocation(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiPageOkResponse({ type: LocationDto })
  async getLocations(@Query() query: InventoryListQueryDto) {
    return this.locationService.getLocations(query);
  }

  @Get('scan/:serialNumber')
  @ApiOkResponse({ type: LocationDto })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async scanLocation(@Param('serialNumber') serialNumber: string) {
    return this.locationService.getLocationBySerialNumber(serialNumber);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: LocationDto,
  })
  async getLocation(@Param('id', new ParseUUIDPipe()) locationId: Uuid) {
    return this.locationService.getLocation(locationId);
  }

  @Patch(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: LocationDto,
  })
  @Auth([RoleType.ADMIN])
  async updateLocation(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateLocationDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating location ${id}`);
    return this.locationService.updateLocation(id, dto, userId);
  }

  @Delete(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: LocationDto,
  })
  @Auth([RoleType.ADMIN])
  async deleteLocation(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.locationService.deleteLocation(id, userId);
  }
}
