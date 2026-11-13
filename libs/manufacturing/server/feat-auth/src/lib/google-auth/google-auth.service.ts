import { OAuth2Client, TokenPayload } from 'google-auth-library';

import { ISocialPayload } from '@meshforge/manufacturing/shared/util-types';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GoogleAuthLoginDto } from './google-login.dto';

@Injectable()
export class GoogleAuthService {
  private google: OAuth2Client;

  constructor(private configService: ConfigService) {
    this.google = new OAuth2Client(
      configService.get<string>('google.clientId'),
      configService.get<string>('google.clientSecret'),
    );
  }

  async getProfileByToken(
    loginDto: GoogleAuthLoginDto,
  ): Promise<ISocialPayload> {
    const audience = this.configService.getOrThrow<string>('google.clientId');
    let data: TokenPayload | undefined;
    try {
      const ticket = await this.google.verifyIdToken({
        idToken: loginDto.idToken,
        audience: [audience],
      });
      data = ticket.getPayload();
    } catch {
      // A malformed, expired or foreign token is a failed sign-in, not a server error.
      throw new UnauthorizedException('Google sign-in token is invalid or expired');
    }

    if (!data?.email || data.email_verified !== true) {
      throw new UnauthorizedException(
        'Google must verify the account email before sign-in',
      );
    }

    return {
      id: data.sub,
      email: data.email,
      firstName: data.given_name,
      lastName: data.family_name,
      avatar: data.picture,
    };
  }
}
