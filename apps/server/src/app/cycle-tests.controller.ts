import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth, ReqUserId } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import { CreateCycleTestDto } from '@meshforge/api/data-access';
import { CycleTestsService } from './cycle-tests.service';
@Controller({ path: 'admin/cycle-tests', version: '1' })
@ApiTags('Lapper cycle simulation')
export class CycleTestsController {
  constructor(private readonly tests: CycleTestsService) {}
  @Get() @Auth([RoleType.ADMIN]) list() { return this.tests.list(); }
  @Post() @Auth([RoleType.ADMIN]) create(@Body() input: CreateCycleTestDto, @ReqUserId() userId: Uuid) {
    return this.tests.create(input, userId);
  }
}
