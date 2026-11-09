import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ServerFeatUserService } from '@gearapps/manufacturing/server/feat-user';
import { STRATEGY_JWT_REFRESH } from '@gearapps/manufacturing/server/util-common';
import { ENV_JWT_REFRESH_SECRET } from '@gearapps/manufacturing/shared/util-constants';
import { IJwtPayload, IRequestUserData } from '@gearapps/manufacturing/shared/util-types';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  STRATEGY_JWT_REFRESH,
) {
  constructor(
    private configService: ConfigService,
    private userService: ServerFeatUserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>(ENV_JWT_REFRESH_SECRET),
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    payload: IJwtPayload & { authVersion?: number; tokenUse?: string },
  ): Promise<IRequestUserData & { refreshToken: string }> {
    if (payload.tokenUse !== 'refresh')
      throw new UnauthorizedException('Refresh token is invalid');
    const refreshToken =
      req
        .get('Authorization')
        ?.replace(/^Bearer\s+/i, '')
        .trim() ?? '';
    const user = await this.userService.getUser(payload.sub);

    if (!user || !user.active || !user.email) {
      throw new UnauthorizedException(
        'Refresh token user is missing, inactive, or invalid',
      );
    }
    if (payload.authVersion !== user.authVersion) {
      throw new UnauthorizedException(
        'Session has been revoked; please sign in again',
      );
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      departmentCode: user.department?.code ?? null,
      departmentDescription: user.department?.description ?? null,
      refreshToken,
    };
  }
}
