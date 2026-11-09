import { CreateUserDto, PublicUserDto, UpdateUserDto } from '@gearapps/api/data-access';
import { Public, ReqUserId } from '@gearapps/api/core';
import { PublicUser } from '@gearapps/shared/domain';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { toPublicUser, UsersService } from './users.service';

@Controller({ path: 'users', version: '1' })
@ApiTags('Users')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user' })
  @ApiOkResponse({ type: PublicUserDto })
  async me(@ReqUserId() userId: string): Promise<PublicUser> {
    return toPublicUser(await this.users.findOne(userId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user (public fields only)' })
  @ApiOkResponse({ type: PublicUserDto })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return toPublicUser(await this.users.findOne(id));
  }

  @Post()
  @Public()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiCreatedResponse({ type: PublicUserDto })
  async create(@Body() body: CreateUserDto): Promise<PublicUser> {
    return toPublicUser(await this.users.create(body));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update your own account' })
  @ApiOkResponse({ type: PublicUserDto })
  async update(
    @ReqUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
  ): Promise<PublicUser> {
    if (userId !== id) throw new ForbiddenException('You can only update your own account');
    return toPublicUser(await this.users.update(id, body));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete your own account' })
  async remove(@ReqUserId() userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (userId !== id) throw new ForbiddenException('You can only delete your own account');
    await this.users.remove(id);
  }
}
