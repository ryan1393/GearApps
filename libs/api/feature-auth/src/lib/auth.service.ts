import {
  AccessTokenPayload,
  LoginPayload,
  PublicUser,
  TokenResponse,
  User,
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

  private async authenticate({ email, password }: LoginPayload): Promise<User> {
    const user = await this.users.findByEmail(email);
    const ok = user ? await this.users.verifyPassword(user, password) : false;
    if (!user || !ok) {
      this.logger.warn(`Failed login for ${email}`);
      throw new UnauthorizedException('Email or password is invalid');
    }
    return user;
  }

  async validateUser(payload: LoginPayload): Promise<PublicUser> {
    return toPublicUser(await this.authenticate(payload));
  }

  async login(payload: LoginPayload): Promise<TokenResponse> {
    const user = (await this.authenticate(payload)) as User & { authVersion?: number };
    const claims: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      fname: user.fname,
      lname: user.lname,
      token_use: 'lapper-access',
      auth_version: user.authVersion,
    };
    return { access_token: await this.jwt.signAsync(claims) };
  }

  /** Returns the decoded payload if the token is valid, otherwise 401. */
  async verify(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      await this.users.validateToken(payload);
      return payload;
    } catch {
      throw new UnauthorizedException('Token is invalid or expired');
    }
  }

  capabilities(): { registrationEnabled: boolean } {
    return { registrationEnabled: this.users.registrationEnabled() };
  }
}
