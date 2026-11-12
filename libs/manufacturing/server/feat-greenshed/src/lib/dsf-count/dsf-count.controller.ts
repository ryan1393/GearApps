import { Auth, ReqUserId } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DsfCountService } from './dsf-count.service';

@Controller({ path: ['greenshed/dsf-counts', 'dsf-counts'], version: '1' })
@ApiTags('Greenshed')
export class DsfCountController {
  constructor(private readonly counts: DsfCountService) {}
  // DSFCOUNT1. Cached source counts plus the local machine catalog; never connects to DSF.
  @Get()
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getCounts() { return this.counts.currentSnapshot(); }

  @Get('admin-mappings')
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN])
  getAdminMappings() { return this.counts.adminSnapshot(); }

  // Proposals only: the DSF source that is the only match for each machine. Changes nothing.
  @Get('admin-mappings/unique-matches')
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN])
  getUniqueMatches() { return this.counts.uniqueMatches(); }

  // Maps the confirmed proposals that are still the only match, each through the normal Admin save.
  @Post('admin-mappings/unique-matches')
  @HttpCode(200)
  @Auth([RoleType.ADMIN])
  applyUniqueMatches(
    @Body() body: { matches?: unknown },
    @ReqUserId() userId: Uuid,
  ) { return this.counts.applyUniqueMatches(body?.matches, userId); }

  // Every DSF source against every active machine, paired loosely by machine number. Changes nothing.
  @Get('admin-mappings/rough-matches')
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN])
  getRoughMatches() { return this.counts.roughMatches(); }

  // Maps the rough matches an administrator picked, each still a candidate, through the normal Admin save.
  @Post('admin-mappings/rough-matches')
  @HttpCode(200)
  @Auth([RoleType.ADMIN])
  applyRoughMatches(
    @Body() body: { matches?: unknown },
    @ReqUserId() userId: Uuid,
  ) { return this.counts.applyRoughMatches(body?.matches, userId); }

  @Put('admin-mappings/:machineId')
  @Auth([RoleType.ADMIN])
  saveAdminMapping(
    @Param('machineId', new ParseUUIDPipe()) machineId: string,
    @Body() body: { mapping_id?: string },
    @ReqUserId() userId: Uuid,
  ) { return this.counts.saveAdminMapping(machineId, String(body?.mapping_id || ''), userId); }

  @Delete('admin-mappings/:machineId')
  @Auth([RoleType.ADMIN])
  unmapAdminMachine(
    @Param('machineId', new ParseUUIDPipe()) machineId: string,
    @ReqUserId() userId: Uuid,
  ) { return this.counts.unmapAdminMachine(machineId, userId); }
}
