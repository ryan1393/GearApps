import {
  ApiPageOkResponse,
  PaginationOptionsDto,
  UpdateLocationTrayDto,
  LocationTrayDto,
  CreateLocationTrayDto,
} from '@meshforge/manufacturing/server/data-access';
import { DepartmentAppEdit, Auth, ReqUserId } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
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
import { ServerFeatLocationTrayService } from './server-feat-location-tray.service';


@Controller({ path: 'locationTrays', version: '1' })
@ApiTags('LocationTrays')
export class ServerFeatLocationTrayController {
  private readonly logger = new Logger(ServerFeatLocationTrayController.name);
  constructor(private locationTrayService: ServerFeatLocationTrayService) { }

  @Post('')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiCreatedResponse({
    type: LocationTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async createLocationTray(
    @Body() dto: CreateLocationTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.locationTrayService.createLocationTray(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN])
  @ApiPageOkResponse({ type: LocationTrayDto })
  async getLocationTrays(@Query() paginationOptions: PaginationOptionsDto) {
    return this.locationTrayService.getLocationTrays(paginationOptions);
  }

  @Get('tray/:trayId/current')
  @ApiOkResponse({ type: LocationTrayDto })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getCurrentTrayLocation(
    @Param('trayId', new ParseUUIDPipe()) trayId: Uuid,
  ) {
    return this.locationTrayService.getCurrentLocationForTray(trayId);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: LocationTrayDto,
  })
  async getLocationTray(@Param('id', new ParseUUIDPipe()) locationTrayId: Uuid) {
    return this.locationTrayService.getLocationTray(locationTrayId);
  }

  @Patch(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: LocationTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async updateLocationTray(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateLocationTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating locationTray ${id}`);
    return this.locationTrayService.updateLocationTray(id, dto, userId);
  }

  @Delete(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: LocationTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async deleteLocationTray(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.locationTrayService.deleteLocationTray(id, userId);
  }
}
