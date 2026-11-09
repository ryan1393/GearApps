import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Auth, DepartmentAppEdit, ReqUserId } from '@libs/server/util-common';
import { RoleType, Uuid } from '@libs/shared/util-types';
import { CoaterShipmentsService } from './coater-shipments.service';
import { CancelCoaterShipmentDto, CoaterContainerDto, CoaterRevisionDto, CreateCoaterShipmentDto, DispatchCoaterShipmentDto, UpdateCoaterShipmentDto } from './coater-shipments.dto';

@Controller({ path: 'coater-shipments', version: '1' })
export class CoaterShipmentsController {
  constructor(private readonly shipments: CoaterShipmentsService) {}

  @Get() @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  list(@Query('tab') tab = 'open', @Query('q') query = '', @Query('page') page = '1') {
    return this.shipments.list(tab === 'history',query,Number(page));
  }
  @Get(':id/available-containers') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  available(@Param('id',new ParseUUIDPipe()) id: string, @Query('q') query = '') { return this.shipments.available(id,query); }

  @Get(':id') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  get(@Param('id',new ParseUUIDPipe()) id: string) { return this.shipments.get(id); }

  @Post() @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  create(@Body() dto: CreateCoaterShipmentDto,@ReqUserId() user: Uuid) { return this.shipments.create(dto.request_id,dto.destination,dto.notes ?? '',user); }

  @Post(':id/details') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  update(@Param('id',new ParseUUIDPipe()) id: string,@Body() dto: UpdateCoaterShipmentDto,@ReqUserId() user: Uuid) { return this.shipments.update(id,dto.revision,dto.destination,dto.notes,user); }

  @Post(':id/containers') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  add(@Param('id',new ParseUUIDPipe()) id: string,@Body() dto: CoaterContainerDto,@ReqUserId() user: Uuid) { return this.shipments.add(id,dto.revision,dto.serial,user); }

  @Post(':id/containers/:containerId/remove') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  remove(@Param('id',new ParseUUIDPipe()) id: string,@Param('containerId',new ParseUUIDPipe()) container: string,@Body() dto: CoaterRevisionDto,@ReqUserId() user: Uuid) { return this.shipments.remove(id,dto.revision,container,user); }

  @Post(':id/review') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  review(@Param('id',new ParseUUIDPipe()) id: string,@Body() dto: CoaterRevisionDto,@ReqUserId() user: Uuid) { return this.shipments.review(id,dto.revision,user); }

  @Post(':id/print') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  print(@Param('id',new ParseUUIDPipe()) id: string,@Body() dto: CoaterRevisionDto,@ReqUserId() user: Uuid) { return this.shipments.print(id,dto.revision,user); }

  @Post(':id/dispatch') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  dispatch(@Param('id',new ParseUUIDPipe()) id: string,@Body() dto: DispatchCoaterShipmentDto,@ReqUserId() user: Uuid) { return this.shipments.dispatch(id,dto.revision,dto.printed_and_checked,user); }

  @Post(':id/labels') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  labels(@Param('id',new ParseUUIDPipe()) id: string,@Body() dto: CoaterRevisionDto,@ReqUserId() user: Uuid) { return this.shipments.labels(id,dto.revision,user); }

  @Post(':id/cancel') @Auth([RoleType.ADMIN,RoleType.USER]) @DepartmentAppEdit('BLADE_TRACKING')
  cancel(@Param('id',new ParseUUIDPipe()) id: string,@Body() dto: CancelCoaterShipmentDto,@ReqUserId() user: Uuid) { return this.shipments.cancel(id,dto.revision,dto.reason,user); }
}
