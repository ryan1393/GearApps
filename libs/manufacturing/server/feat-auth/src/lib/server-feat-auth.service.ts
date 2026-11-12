import { InjectDataSource } from '@nestjs/typeorm';
import { Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';

import {
  TokenResponseDto,
  UserLoginDto,
  UserOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { ServerFeatUserService } from '@meshforge/manufacturing/server/feat-user';
import { UserNotFoundException } from '@meshforge/manufacturing/server/util-common';
import {
  ENV_EMAIL_ENABLED,
  ENV_JWT_ACCESS_EXPIRATION_TIME,
  ENV_JWT_ACCESS_SECRET,
  ENV_JWT_REFRESH_EXPIRATION_TIME,
  ENV_JWT_REFRESH_SECRET,
} from '@meshforge/manufacturing/shared/util-constants';
import {
  AuthProviderType,
  IForgotPasswordPayload,
  IResetPasswordPayload,
  ISocialPayload,
  ITokenResponse,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class ServerFeatAuthService {
  private logger = new Logger(ServerFeatAuthService.name);
  constructor(
    private jwtService: JwtService,
    private userService: ServerFeatUserService,
    private configService: ConfigService,
    @Optional() @InjectDataSource() private readonly source?: DataSource,
  ) {}

  /** Emailed password reset needs outgoing mail; without it the forgot-password form can only fail silently. */
  get passwordResetEmailEnabled(): boolean {
    return this.configService.get(ENV_EMAIL_ENABLED) === 'true';
  }

  async generateAccessToken(data: UserOrmEntity): Promise<string> {
    const assigned = this.source ? await this.source.query(
      `SELECT r.permissions,r.enabled FROM meshforge_user_roles u JOIN meshforge_roles r ON r.id=u.role_id WHERE u.user_id=$1`, [data.id],
    ) : [];
    const payload = {
      permissions: assigned.length ? (assigned[0].enabled ? assigned[0].permissions : []) : null,
      email: data.email,
      role: data.role,
      departmentId: data.departmentId,
      departmentCode: data.department?.code ?? null,
      departmentDescription: data.department?.description ?? null,
      firstName: data.firstName,
      lastName: data.lastName,
      authVersion: data.authVersion,
      tokenUse: 'access',
    };
    return await this.jwtService.signAsync(payload, {
      expiresIn: this.configService.get(ENV_JWT_ACCESS_EXPIRATION_TIME),
      subject: data.id,
      secret: this.configService.get(ENV_JWT_ACCESS_SECRET),
    });
  }

  async generateRefreshToken(data: UserOrmEntity): Promise<string> {
    const token = await this.jwtService.signAsync(
      {
        email: data.email,
        role: data.role,
        departmentId: data.departmentId,
        departmentCode: data.department?.code ?? null,
        departmentDescription: data.department?.description ?? null,
        authVersion: data.authVersion,
        tokenUse: 'refresh',
      },
      {
        expiresIn: this.configService.get(ENV_JWT_REFRESH_EXPIRATION_TIME),
        subject: data.id,
        secret: this.configService.get(ENV_JWT_REFRESH_SECRET),
        jwtid: randomUUID(),
      },
    );
    return token;
  }

  async getTokens(
    data: UserOrmEntity,
    expectedRefreshDigest?: string,
  ): Promise<TokenResponseDto> {
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(data),
      this.generateRefreshToken(data),
    ]);

    const stored = await this.userService.replaceRefreshToken(
      data,
      this.tokenDigest(refreshToken),
      expectedRefreshDigest,
    );
    if (!stored)
      throw new UnauthorizedException(
        'Credentials changed; please sign in again',
      );

    return new TokenResponseDto({ accessToken, refreshToken });
  }

  async validateUser(userLoginDto: UserLoginDto): Promise<UserOrmEntity> {
    if (Buffer.byteLength(userLoginDto.password, 'utf8') > 72) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const user = await this.userService.findByEmail(userLoginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.active) {
      throw new ForbiddenException('User account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      userLoginDto.password,
      user.password ?? '',
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return user;
  }

  async getMe(userId: Uuid) {
    const user = await this.userService.findUser({ id: userId });
    if (!user) {
      throw new UserNotFoundException();
    }
    return user;
  }

  async refreshTokens(userId: string, refreshToken: string) {
    if (!userId || refreshToken == '') {
      throw new UnauthorizedException('Refresh token is missing or invalid');
    }

    const user = await this.userService.getUser(userId);
    if (!user.active) {
      throw new ForbiddenException('User account is inactive');
    }
    const digest = this.tokenDigest(refreshToken);
    if (user.refreshToken !== digest) {
      throw new ForbiddenException(`Invalid refresh token`);
    }
    return await this.getTokens(user, digest);
  }

  private tokenDigest(token: string): string {
    // Hash every byte: JWTs exceed bcrypt's 72-byte input limit.
    return createHash('sha256').update(token).digest('hex');
  }

  async validateSocialUser(
    provider: AuthProviderType,
    data: ISocialPayload,
  ): Promise<ITokenResponse> {
    const user = data.email
      ? await this.userService.findByEmail(data.email)
      : null;
    if (
      !user?.active ||
      !user.isEmailVerified ||
      user.socialProvider !== provider ||
      !user.socialId ||
      user.socialId !== data.id
    ) {
      throw new UnauthorizedException(
        'Google sign-in is not configured for this account',
      );
    }
    return this.getTokens(user);
  }

  async verifyUserEmail(email: string, code: string) {
    if (
      typeof email !== 'string' ||
      typeof code !== 'string' ||
      !/^[a-f0-9]{128}$/.test(code)
    ) {
      throw new UnauthorizedException('Email verification code is invalid');
    }
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new NotFoundException(
        'User account was not found for email verification',
      );
    }
    if (code !== user.verificationHash) {
      throw new UnauthorizedException('Email verification code is invalid');
    }
    this.logger.debug(`User ${email} has now been verified!`);
    await this.userService.updateUser(user.id, {
      isEmailVerified: true,
      verificationHash: null,
      emailVerifiedOn: new Date(),
    });
  }

  async forgotPassword(dto: IForgotPasswordPayload) {
    return this.userService.forgotPassword(dto);
  }

  async resetPassword(dto: IResetPasswordPayload & { code: string }) {
    return this.userService.resetPassword(dto);
  }
}
