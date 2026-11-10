import { Auth, ReqUserId } from '@gearapps/manufacturing/server/util-common';
import { RoleType, Uuid } from '@gearapps/manufacturing/shared/util-types';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateAdminMachineDto,
  CreateAdminModelDto,
  UpdateAdminMachineDto,
  UpdateAdminModelDto,
} from './admin-master-data.dto';
import { AdminMasterDataService } from './admin-master-data.service';

@Controller({ path: 'admin/master-data', version: '1' })
@ApiTags('Admin Master Data')
export class AdminMasterDataController {
  constructor(private readonly service: AdminMasterDataService) {}

  @Get('departments')
  @Auth([RoleType.ADMIN])
  listDepartments() {
    return this.service.listDepartments();
  }

  @Get('models')
  @Auth([RoleType.ADMIN])
  listModels() {
    return this.service.listModels();
  }

  @Post('models')
  @Auth([RoleType.ADMIN])
  createModel(
    @Body() dto: CreateAdminModelDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.createModel(dto, userId);
  }


  @Patch('models/:id')
  @Auth([RoleType.ADMIN])
  updateModel(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateAdminModelDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.updateModel(id, dto, userId);
  }

  @Delete('models/:id')
  @Auth([RoleType.ADMIN])
  disableModel(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.disableModel(id, userId);
  }

  @Get('machines')
  @Auth([RoleType.ADMIN])
  listMachines() {
    return this.service.listMachines();
  }

  @Post('machines')
  @Auth([RoleType.ADMIN])
  createMachine(
    @Body() dto: CreateAdminMachineDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.createMachine(dto, userId);
  }


  @Patch('machines/:id')
  @Auth([RoleType.ADMIN])
  updateMachine(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateAdminMachineDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.updateMachine(id, dto, userId);
  }

  @Delete('machines/:id')
  @Auth([RoleType.ADMIN])
  disableMachine(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.disableMachine(id, userId);
  }
}
