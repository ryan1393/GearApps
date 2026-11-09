import { LoginRequestDto, TokenResponseDto } from '@gearapps/api/data-access';
import { Public } from '@gearapps/api/core';
import { AccessTokenPayload, TokenResponse } from '@gearapps/shared/domain';
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@Controller({ path: 'auth', version: '1' })
@ApiTags('Authentication')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('capabilities')
  @Public()
  capabilities(): { registrationEnabled: boolean } {
    return this.auth.capabilities();
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for a bearer token' })
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiUnauthorizedResponse()
  login(@Body() body: LoginRequestDto): Promise<TokenResponse> {
    return this.auth.login(body);
  }

  @Post('check-token')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a token and return its claims' })
  @ApiUnauthorizedResponse()
  checkToken(@Body() body: TokenResponseDto): Promise<AccessTokenPayload> {
    return this.auth.verify(body.access_token);
  }
}
