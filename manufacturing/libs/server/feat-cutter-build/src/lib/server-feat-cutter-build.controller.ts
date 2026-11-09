import { DepartmentAppEdit, Auth, ReqUserId } from '@libs/server/util-common';
import { RoleType, Uuid } from '@libs/shared/util-types';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  AssignCutterBodyDanaSerialDto,
  CreateCutterBodyDto,
  CreateCutterBuilderBuildDto,
  CreateCutterTeardownDto,
  UpdateCutterBodyDto,
} from './cutter-build.dto';
import { ServerFeatCutterBuildService } from './server-feat-cutter-build.service';

@Controller({ path: 'cutter-builder', version: '1' })
@ApiTags('Cutter Builder')
export class ServerFeatCutterBuildController {
  constructor(private readonly service: ServerFeatCutterBuildService) {}

  @Post('cutter-bodies')
  @DepartmentAppEdit('CUTTER_BUILDER')
  @Auth([RoleType.ADMIN])
  createCutterBody(
    @Body() dto: CreateCutterBodyDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.createCutterBody(dto, userId);
  }


  @Get('cutter-bodies/admin')
  @Auth([RoleType.ADMIN])
  listCutterBodiesAdmin() {
    return this.service.listCutterBodiesAdmin();
  }

  @Patch('cutter-bodies/:id')
  @DepartmentAppEdit('CUTTER_BUILDER')
  @Auth([RoleType.ADMIN])
  updateCutterBody(
    @Param('id') id: Uuid,
    @Body() dto: UpdateCutterBodyDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.updateCutterBody(id, dto, userId);
  }

  @Get('cutter-bodies')
  @Auth([RoleType.ADMIN, RoleType.USER])
  listCutterBodies() {
    return this.service.listCutterBodies();
  }

  @Patch('cutter-bodies/:id/dana-serial')
  @DepartmentAppEdit('CUTTER_BUILDER')
  @Auth([RoleType.ADMIN])
  assignCutterBodyDanaSerial(
    @Param('id') id: Uuid,
    @Body() dto: AssignCutterBodyDanaSerialDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.assignCutterBodyDanaSerial(id, dto, userId);
  }

  @Get('cutter-bodies/scan/:serialNumber')
  @Auth([RoleType.ADMIN, RoleType.USER])
  scanCutterBody(@Param('serialNumber') serialNumber: string) {
    // Accepts scanned Dana S/N or manually entered MF S/N.
    return this.service.getCutterBodyBySerial(serialNumber);
  }



  @Get('machines')
  @Auth([RoleType.ADMIN, RoleType.USER])
  listCutterBuilderMachines() {
    return this.service.listCutterBuilderMachines();
  }

  @Get('dashboard')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getDashboard() {
    return this.service.getDashboard();
  }

  @Get('builds')
  @Auth([RoleType.ADMIN, RoleType.USER])
  searchBuilds(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('partType') partType?: string,
    @Query('cutterBody') cutterBody?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.searchBuilds({
      q,
      status,
      partType,
      cutterBody,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('builds')
  @DepartmentAppEdit('CUTTER_BUILDER')
  @Auth([RoleType.ADMIN, RoleType.USER])
  createBuild(
    @Body() dto: CreateCutterBuilderBuildDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.createBuild(dto, userId);
  }


  @Post('teardowns')
  @DepartmentAppEdit('CUTTER_BUILDER')
  @Auth([RoleType.ADMIN, RoleType.USER])
  teardownBuild(
    @Body() dto: CreateCutterTeardownDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.teardownBuild(dto, userId);
  }

  @Get('teardowns/:buildNumber')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getTeardown(@Param('buildNumber') buildNumber: string) {
    return this.service.getTeardownByBuildNumber(buildNumber);
  }

  @Get('builds/:buildNumber')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getBuild(@Param('buildNumber') buildNumber: string) {
    return this.service.getBuildByNumber(buildNumber);
  }

  @Get('builds/:buildNumber/card')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getCutterCard(@Param('buildNumber') buildNumber: string) {
    return this.service.getCutterCard(buildNumber);
  }
}
