import { Auth, ReqUserId } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DsfCountService } from './dsf-count.service';

@Controller({ path: 'greenshed/dsf-counts', version: '1' })
@ApiTags('Greenshed')
export class DsfCountController {
  constructor(private readonly counts: DsfCountService) {}
  // DSFCOUNT1. A browser request reads memory only. No source connection or refresh here.
  @Get()
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getCounts() { return this.counts.snapshot(); }

  @Get('admin-mappings')
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN])
  getAdminMappings() { return this.counts.adminSnapshot(); }

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
