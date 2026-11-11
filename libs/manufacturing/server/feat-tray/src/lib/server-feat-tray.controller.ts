import {
  ApiPageOkResponse,
  InventoryListQueryDto,
  UpdateTrayDto,
  TrayDto,
  CreateTrayDto,
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

import { ServerFeatTrayService } from './server-feat-tray.service';
import { StartTrayGrindingDto, CompleteTrayGrindingDto, PlaceEmptyBodyDto, RemoveEmptyBodyDto, InventoryAvailabilityQueryDto } from './tray-workflow.dto';

@Controller({ path: 'trays', version: '1' })
@ApiTags('Trays')
export class ServerFeatTrayController {
  private readonly logger = new Logger(ServerFeatTrayController.name);
  constructor(private trayService: ServerFeatTrayService) { }

  @Get('grinding-machines')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getGrindingMachines() { return this.trayService.getGrindingMachines(); }

  @Get('grinding-machines/:machineId/runs')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getMachineGrindingRuns(@Param('machineId', new ParseUUIDPipe()) machineId: Uuid) {
    return this.trayService.getMachineGrindingRuns(machineId);
  }

  @Post('')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiCreatedResponse({
    type: TrayDto,
  })
  @Auth([RoleType.ADMIN])
  async createTray(
    @Body() dto: CreateTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.trayService.createTray(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiPageOkResponse({ type: TrayDto })
  async getTrays(@Query() query: InventoryListQueryDto) {
    return this.trayService.getTrays(query);
  }

  @Get('dashboard')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getDashboard() {
    return this.trayService.getDashboard();
  }


  @Get('availability')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getAvailability(
    @Query() query: InventoryAvailabilityQueryDto,
  ) {
    return this.trayService.getInventoryAvailability(query.summaryId, query.partTypeId || null);
  }

  @Get('body-shelves')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getBodyShelves() { return this.trayService.getEmptyBodyShelves(); }

  @Post('body-shelves/place')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async placeBody(@Body() dto: PlaceEmptyBodyDto, @ReqUserId() userId: Uuid) {
    return this.trayService.placeEmptyBody(dto.body_identifier, dto.shelf_serial, userId);
  }

  @Post('body-shelves/remove')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async removeBody(@Body() dto: RemoveEmptyBodyDto, @ReqUserId() userId: Uuid) {
    return this.trayService.placeEmptyBody(dto.body_identifier, null, userId, dto.placement_id);
  }

  @Get('scan/:serialNumber')
  @ApiOkResponse({ type: TrayDto })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async scanTray(@Param('serialNumber') serialNumber: string) {
    return this.trayService.getTrayBySerialNumber(serialNumber);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: TrayDto,
  })
  async getTray(@Param('id', new ParseUUIDPipe()) trayId: Uuid) {
    return this.trayService.getTray(trayId);
  }



  @Post(':id/start-grinding')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async startGrinding(
    @Body() dto: StartTrayGrindingDto,
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.trayService.startGrinding(id, userId, dto.grinding_machine_id);
  }

  @Post(':id/complete-grinding')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async completeGrinding(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: CompleteTrayGrindingDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.trayService.completeGrinding(
      id,
      dto.summary_id,
      dto.part_type_id,
      dto.scrapped_blade_count,
      userId,
      dto.rough_shelf_serial_number,
      dto.grinding_machine_id,
    );
  }


  @Get(':id/grinding-runs')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getGrindingRuns(@Param('id', new ParseUUIDPipe()) id: Uuid) {
    return this.trayService.getGrindingRuns(id);
  }

  @Get(':id/readiness')
  @Auth([RoleType.ADMIN, RoleType.USER])
  async getReadiness(@Param('id', new ParseUUIDPipe()) id: Uuid) {
    return this.trayService.getReadiness(id);
  }

  @Patch(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: TrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async updateTray(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateTrayDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating tray ${id}`);
    return this.trayService.updateTray(id, dto, userId);
  }

  @Delete(':id')
  @DepartmentAppEdit('BLADE_TRACKING')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: TrayDto,
  })
  @Auth([RoleType.ADMIN, RoleType.USER])
  async deleteTray(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqUserId() userId: Uuid,
  ) {
    return this.trayService.deleteTray(id, userId);
  }
}
