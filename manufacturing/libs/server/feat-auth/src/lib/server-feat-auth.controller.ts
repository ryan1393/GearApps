import { Request } from 'express';

import {
  ForgotPasswordDto,
  ResetPasswordDto,
  TokenResponseDto,
  UserDto,
  UserLoginDto,
} from '@gearapps/manufacturing/server/data-access';
import {
  Auth,
  JwtRefreshTokenGuard,
  ReqUserId,
  SkipAuth,
} from '@gearapps/manufacturing/server/util-common';
import { IRequestUserData, RoleType, Uuid } from '@gearapps/manufacturing/shared/util-types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ServerFeatAuthService } from './server-feat-auth.service';

@Controller({
  path: 'auth',
  version: '1',
})
@ApiTags('Authentication')
export class ServerFeatAuthController {
  private logger = new Logger('AuthController');
  constructor(private authService: ServerFeatAuthService) {}

  @Get('capabilities')
  @SkipAuth()
  capabilities() {
    return { registrationEnabled: false };
  }

  @Post('email/login')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: TokenResponseDto,
  })
  async emailLogin(@Body() dto: UserLoginDto): Promise<TokenResponseDto> {
    const user = await this.authService.validateUser({
      email: dto.email,
      password: dto.password,
    });
    return this.authService.getTokens(user);
  }

  @Get('email/verify')
  @SkipAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(
    @Query('code') code: string,
    @Query('email') email: string,
  ): Promise<void> {
    return await this.authService.verifyUserEmail(email, code);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @Auth([RoleType.USER, RoleType.ADMIN])
  @ApiOkResponse({ type: UserDto })
  async getCurrentUser(@ReqUserId() userId: Uuid): Promise<UserDto> {
    Logger.debug(`Looking up user with ID: ${userId}`);
    return this.authService.getMe(userId);
  }

  @Get('refresh')
  @SkipAuth()
  @ApiBearerAuth()
  @UseGuards(JwtRefreshTokenGuard)
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(@Req() req: Request): Promise<TokenResponseDto> {
    const user = req.user as IRequestUserData & { refreshToken: string };
    this.logger.debug(`Refreshing token for ${user.email}`);
    return this.authService.refreshTokens(user.id, user.refreshToken);
  }

  @Post('email/forgot-password')
  @SkipAuth()
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    this.logger.debug(`${dto.email} is requesting to change their password`);
    return this.authService.forgotPassword(dto);
  }

  @Post('email/reset-password')
  @SkipAuth()
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Query('code') code: string,
  ): Promise<void> {
    this.logger.debug(`Updating password for ${dto.email}`);
    return this.authService.resetPassword({ ...dto, code });
  }
}
