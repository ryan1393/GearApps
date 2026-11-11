import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth, ReqUserId } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import { CreateCycleTestDto, ReadControllerValuesDto, SendArgonautTestDto } from '@meshforge/api/data-access';
import { ControllerValuesService } from './controller-values.service';
import { ArgonautTestService } from './argonaut-test.service';
import { CycleTestsService } from './cycle-tests.service';
@Controller({ path: 'admin/cycle-tests', version: '1' })
@ApiTags('Lapper cycle simulation')
export class CycleTestsController {
  constructor(
    private readonly tests: CycleTestsService,
    private readonly argonaut: ArgonautTestService,
    private readonly controller: ControllerValuesService,
  ) {}
  @Get() @Auth([RoleType.ADMIN]) list() { return this.tests.list(); }
  @Post() @Auth([RoleType.ADMIN]) create(@Body() input: CreateCycleTestDto, @ReqUserId() userId: Uuid) {
    return this.tests.create(input, userId);
  }
  /** Sends a real Argonaut transaction built like Lapper Read's; nothing is saved in MeshForge. */
  @Post('argonaut') @Auth([RoleType.ADMIN]) sendToArgonaut(@Body() input: SendArgonautTestDto, @ReqUserId() userId: Uuid) {
    return this.argonaut.send(input, userId);
  }
  /** The address and request Send to Argonaut would use; nothing is sent. */
  @Post('argonaut/preview') @Auth([RoleType.ADMIN]) previewArgonaut(@Body() input: SendArgonautTestDto) {
    return this.argonaut.prepare(input);
  }
  /** The machine's current macro values, read by Lapper Read from its FANUC controller. Nothing is saved. */
  @Post('controller-values') @Auth([RoleType.ADMIN]) readControllerValues(@Body() input: ReadControllerValuesDto, @ReqUserId() userId: Uuid) {
    return this.controller.read(input.machine_id, userId);
  }
}
