import { OAuth2Client } from 'google-auth-library';

import { ISocialPayload } from '@libs/shared/util-types';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GoogleAuthLoginDto } from './google-login.dto';

@Injectable()
export class GoogleAuthService {
  private google: OAuth2Client;

  constructor(private configService: ConfigService) {
    this.google = new OAuth2Client(
      configService.get('google.clientId', { infer: true }),
      configService.get('google.clientSecret', { infer: true }),
    );
  }

  async getProfileByToken(
    loginDto: GoogleAuthLoginDto,
  ): Promise<ISocialPayload> {
    const ticket = await this.google.verifyIdToken({
      idToken: loginDto.idToken,
      audience: [
        this.configService.getOrThrow('google.clientId', { infer: true }),
      ],
    });

    const data = ticket.getPayload();

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
