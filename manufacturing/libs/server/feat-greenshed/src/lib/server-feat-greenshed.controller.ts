import { DepartmentAppEdit, Auth, ReqUserId } from '@libs/server/util-common';
import { RoleType, Uuid } from '@libs/shared/util-types';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  PullCutterDto,
  QualityCheckDto,
  SetupCutterDto,
  UpdatePieceCountDto,
} from './greenshed.dto';
import { ServerFeatGreenshedService } from './server-feat-greenshed.service';

@Controller({ path: 'greenshed', version: '1' })
@ApiTags('Greenshed')
export class ServerFeatGreenshedController {
  constructor(private readonly service: ServerFeatGreenshedService) {}

  @Get('dashboard')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getDashboard() {
    return this.service.getDashboard();
  }

  @Get('reference-data')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getReferenceData() {
    return this.service.getReferenceData();
  }

  @Get('builds/:buildNumber')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getBuild(@Param('buildNumber') buildNumber: string) {
    return this.service.getBuild(buildNumber);
  }


  @Get('running-machines')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getRunningMachines(@Query('active') active = 'ACTIVE') {
    return this.service.getRunningMachines(active);
  }

  @Get('machines/:machineNumber')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getMachine(@Param('machineNumber') machineNumber: string) {
    return this.service.getMachine(machineNumber);
  }

  @Get('history/:buildNumber')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getHistory(@Param('buildNumber') buildNumber: string) {
    return this.service.getHistory(buildNumber);
  }

  @Get('builds')
  @Auth([RoleType.ADMIN, RoleType.USER])
  searchBuilds(@Query('q') q?: string, @Query('status') status?: string) {
    return this.service.searchBuilds(q, status);
  }

  @Post('setup')
  @DepartmentAppEdit('GREENSHED')
  @Auth([RoleType.ADMIN, RoleType.USER])
  setupCutter(@Body() dto: SetupCutterDto, @ReqUserId() userId: Uuid) {
    return this.service.setupCutter(dto, userId);
  }

  @Post('quality-check')
  @DepartmentAppEdit('GREENSHED')
  @Auth([RoleType.ADMIN, RoleType.USER])
  qualityCheck(@Body() dto: QualityCheckDto, @ReqUserId() userId: Uuid) {
    return this.service.qualityCheck(dto, userId);
  }

  @Post('machines/:machineNumber/piece-count')
  @DepartmentAppEdit('GREENSHED')
  @Auth([RoleType.ADMIN, RoleType.USER])
  updatePieceCount(
    @Param('machineNumber') machineNumber: string,
    @Body() dto: UpdatePieceCountDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.updatePieceCount(machineNumber, dto.piece_count, userId);
  }

  @Post('pull')
  @DepartmentAppEdit('GREENSHED')
  @Auth([RoleType.ADMIN, RoleType.USER])
  pullCutter(@Body() dto: PullCutterDto, @ReqUserId() userId: Uuid) {
    return this.service.pullCutter(dto, userId);
  }
}
