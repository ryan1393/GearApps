import { ExtractJwt, Strategy } from 'passport-jwt';

import { ServerFeatUserService } from '@libs/server/feat-user';
import { STRATEGY_JWT_ACCESS } from '@libs/server/util-common';
import { ENV_JWT_ACCESS_SECRET } from '@libs/shared/util-constants';
import { IJwtPayload, IRequestUserData } from '@libs/shared/util-types';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(
  Strategy,
  STRATEGY_JWT_ACCESS,
) {
  constructor(
    configService: ConfigService,
    private readonly userService: ServerFeatUserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get(ENV_JWT_ACCESS_SECRET),
    });
  }

  async validate(
    payload: IJwtPayload & { authVersion?: number; tokenUse?: string },
  ): Promise<IRequestUserData> {
    if (payload.tokenUse !== 'access')
      throw new UnauthorizedException('Access token is invalid');
    const user = await this.userService.findUser({ id: payload.sub });
    if (!user || !user.active || !user.email)
      throw new UnauthorizedException(
        'Access token user is missing, inactive, or invalid',
      );
    if (payload.authVersion !== user.authVersion)
      throw new UnauthorizedException(
        'Session has been revoked; please sign in again',
      );

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      departmentCode: user.department?.code ?? null,
      departmentDescription: user.department?.description ?? null,
    };
  }
}
