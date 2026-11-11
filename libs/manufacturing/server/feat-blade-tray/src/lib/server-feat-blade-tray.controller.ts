import {
  ApiPageOkResponse,
  PaginationOptionsDto,
  UpdateBladeTrayDto,
  BladeTrayDto,
  CreateBladeTrayDto,
  CreateBladeBatchDto,
} from '@meshforge/manufacturing/server/data-access';
import { DepartmentAppEdit, Auth, ReqUserId, UUIDParam } from '@meshforge/manufacturing/server/util-common';
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
import { ServerFeatBladeTrayService } from './server-feat-blade-tray.service';
import { OpeningInventoryDto, OpeningInventoryService } from './opening-inventory.service';


@Controller({ path: 'bladeTrays', version: '1' })
@ApiTags('BladeTrays')
export class ServerFeatBladeTrayController {
  private readonly logger = new Logger(ServerFeatBladeTrayController.name);
  constructor(private bladeTrayService: ServerFeatBladeTrayService, private openingInventory: OpeningInventoryService) { }

  @Post('batch')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async createBladeBatch(
    @Body() dto: CreateBladeBatchDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.bladeTrayService.createBladeBatch(dto, userId);
  }

  /** Go-live only: record a tray that is already ground or coated, as found on the floor. */
  @Post('opening-inventory')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN])
  recordOpeningInventory(@Body() dto: OpeningInventoryDto, @ReqUserId() userId: Uuid) {
    return this.openingInventory.record(dto, userId);
  }

  @Post('')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiCreatedResponse({
    type: BladeTrayDto,
  })
  @Auth([RoleType.ADMIN])
  async createBladeTray(
    @Body() dto: CreateBladeTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.bladeTrayService.createBladeTray(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN])
  @ApiPageOkResponse({ type: BladeTrayDto })
  async getBladeTrays(@Query() paginationOptions: PaginationOptionsDto) {
    return this.bladeTrayService.getBladeTrays(paginationOptions);
  }


  @Get('tray/:trayId/active')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getActiveBladesForTray(
    @Param('trayId', new ParseUUIDPipe()) trayId: Uuid,
  ) {
    return this.bladeTrayService.getActiveBladesForTray(trayId);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: BladeTrayDto,
  })
  async getBladeTray(@Param('id', new ParseUUIDPipe()) bladeTrayId: Uuid) {
    return this.bladeTrayService.getBladeTray(bladeTrayId);
  }

  @Patch(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: BladeTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async updateBladeTray(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateBladeTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating bladeTray ${id}`);
    return this.bladeTrayService.updateBladeTray(id, dto, userId);
  }

  @Delete(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: BladeTrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async deleteBladeTray(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.bladeTrayService.deleteBladeTray(id, userId);
  }
}
