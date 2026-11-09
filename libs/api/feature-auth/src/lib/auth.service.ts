import {
  AccessTokenPayload,
  LoginPayload,
  PublicUser,
  TokenResponse,
} from '@gearapps/shared/domain';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { toPublicUser, UsersService } from './users.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async validateUser({ email, password }: LoginPayload): Promise<PublicUser> {
    const user = await this.users.findByEmail(email);
    const ok = user ? await this.users.verifyPassword(user, password) : false;
    if (!user || !ok) {
      this.logger.warn(`Failed login for ${email}`);
      throw new UnauthorizedException('Email or password is invalid');
    }
    return toPublicUser(user);
  }

  async login(payload: LoginPayload): Promise<TokenResponse> {
    const user = await this.validateUser(payload);
    const claims: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      fname: user.fname,
      lname: user.lname,
    };
    return { access_token: await this.jwt.signAsync(claims) };
  }

  /** Returns the decoded payload if the token is valid, otherwise 401. */
  async verify(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Token is invalid or expired');
    }
  }
}
