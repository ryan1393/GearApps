import { SkipAuth } from '@meshforge/manufacturing/server/util-common';
import { AuthProviderType, ITokenResponse } from '@meshforge/manufacturing/shared/util-types';
import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';

import { AuthAttemptLimits, clientAddress } from '../auth-attempt-limits';
import { ServerFeatAuthService } from '../server-feat-auth.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleAuthLoginDto } from './google-login.dto';

@Controller({
  path: 'auth/google',
  version: '1',
})
@ApiTags('Authentication')
export class GoogleAuthController {
  constructor(
    private authService: ServerFeatAuthService,
    private googleService: GoogleAuthService,
    private limits: AuthAttemptLimits,
  ) {}

  @Post('login')
  @SkipAuth()
  async login(@Body() dto: GoogleAuthLoginDto, @Req() req: Request): Promise<ITokenResponse> {
    this.limits.assertSignInAddress(clientAddress(req), req.res);
    const user = await this.googleService.getProfileByToken(dto);
    return await this.authService.validateSocialUser(
      AuthProviderType.GOOGLE,
      user,
    );
  }
}
