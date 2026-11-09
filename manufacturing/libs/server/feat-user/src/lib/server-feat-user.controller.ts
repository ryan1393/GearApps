import {
  ApiPageOkResponse,
  PaginationOptionsDto,
  UpdateUserDto,
  UserDto,
} from '@gearapps/manufacturing/server/data-access';
import { Auth, ReqUserId, UUIDParam } from '@gearapps/manufacturing/server/util-common';
import { RoleType, Uuid } from '@gearapps/manufacturing/shared/util-types';
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
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';

import { ServerFeatUserService } from './server-feat-user.service';
import { AdminCreateUserDto } from './admin-create-user.dto';

@Controller({ path: 'users', version: '1' })
@ApiTags('Users')
export class ServerFeatUserController {
  private readonly logger = new Logger(ServerFeatUserController.name);
  constructor(private readonly userService: ServerFeatUserService) {}

  @Post('')
  @Auth([RoleType.ADMIN])
  async createUser(
    @Body() dto: AdminCreateUserDto,
    @ReqUserId() adminUserId: Uuid,
  ) {
    return this.userService.createUserByAdmin(
      {
        email: dto.email.trim().toLowerCase(),
        password: dto.password,
        firstName: dto.firstName?.trim() || null,
        lastName: dto.lastName?.trim() || null,
        role: dto.role,
        departmentId: dto.departmentId,
      },
      adminUserId,
    );
  }

  @Get('')
  @Auth([RoleType.ADMIN])
  @ApiPageOkResponse({ type: UserDto })
  async getUsers(@Query() paginationOptions: PaginationOptionsDto) {
    return this.userService.getUsers(paginationOptions);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: UserDto,
  })
  async getUser(@Param('id', new ParseUUIDPipe()) userId: Uuid) {
    return this.userService.getUser(userId);
  }

  @Patch(':id')
  @Auth([RoleType.ADMIN])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: UserDto,
  })
  async updateUser(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdateUserDto,
  ) {
    this.logger.debug(`Updating user ${id}`);
    return this.userService.updateUser(id, dto);
  }

  @Delete(':id')
  @Auth([RoleType.ADMIN])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: UserDto,
  })
  async deleteUser(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.userService.deleteUser(id);
  }
}
