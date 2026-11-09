import { TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RxoExpediteService } from './rxo-expedite.service';
import type { CredentialInput, ExpediteSettingsInput } from './rxo-expedite.types';

/** Thin HTTP adapter for the Expedite service. Business logic stays in the service. */
@TruckLogAdminWrites()
@Controller('rxo/expedite')
export class RxoExpediteController {
  constructor(private readonly expedite: RxoExpediteService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  status() {
    return this.expedite.status();
  }

  @Get('check-in-loads')
  @Header('Cache-Control', 'no-store')
  checkInLoads() {
    return this.expedite.checkInLoads();
  }

  @Get('shipments')
  @Header('Cache-Control', 'no-store')
  shipments() {
    return this.expedite.shipments();
  }

  @Post('recover')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  recover(@Req() request: Request) {
    this.requireJson(request);
    return this.expedite.recoverConnection();
  }

  @Put('settings')
  @Header('Cache-Control', 'no-store')
  settings(@Body() body: ExpediteSettingsInput, @Req() request: Request) {
    this.requireJson(request);
    return this.expedite.updateSettings(
      body,
      request.headers.origin,
      request.headers['x-truck-log-expedite-intent'],
    );
  }

  @Put('credentials')
  @Header('Cache-Control', 'no-store')
  credentials(@Body() body: CredentialInput, @Req() request: Request) {
    this.requireJson(request);
    return this.expedite.updateCredentials(
      body,
      request.headers.origin,
      request.headers['x-truck-log-expedite-intent'],
    );
  }

  private requireJson(request: Request): void {
    if (!request.is('application/json')) {
      throw new BadRequestException('JSON content is required.');
    }
  }
}
