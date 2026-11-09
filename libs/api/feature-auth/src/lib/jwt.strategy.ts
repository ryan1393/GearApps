import { jwtConfig, RequestUser } from '@gearapps/api/core';
import { AccessTokenPayload } from '@gearapps/shared/domain';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(jwtConfig.KEY) jwt: ConfigType<typeof jwtConfig>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt.secret,
    });
  }

  /** Passport has already verified the signature; shape the payload for `req.user`. */
  validate(payload: AccessTokenPayload): RequestUser {
    const { sub, email, fname, lname } = payload;
    return { userId: sub, email, fname, lname };
  }
}
