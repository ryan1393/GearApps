import { TruckLogAdminService, TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import { UseInterceptors } from '@nestjs/common';
import { RxoControlStatusTimeoutInterceptor } from './rxo-control-timeout.interceptor';
// TRUCK LOG RXO CONTROL STATUS TIMEOUT
import { BadRequestException, Body, Controller, Get, Header, HttpCode, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RxoControlService } from './rxo-control.service';

@TruckLogAdminWrites()
@Controller('rxo/control')
export class RxoControlController {
  constructor(private readonly control: RxoControlService, private readonly admin: TruckLogAdminService) {}

  @UseInterceptors(new RxoControlStatusTimeoutInterceptor())

  @Get()
  async status(@Req() req: Request) {
    const status = await this.control.status();
    // The RXO login name is shown only to a signed-in administrator.
    let admin = false;
    try { await this.admin.session(req as never); admin = true; } catch { admin = false; }
    return admin ? status : { ...status, credentials: { ...status.credentials, username: '' } };
  }

  @Patch('settings')
  settings(@Body() body: { syncIntervalMinutes?: number; maxScanDurationMinutes?: number; noProgressTimeoutMinutes?: number }) {
    return this.control.updateSettings(body ?? {});
  }

  @Put('credentials')
  credentials(@Body() body: { username?: string; password?: string }) {
    return this.control.updateCredentials(body ?? {});
  }

  @Post('recover')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  recover(@Req() request: Request) {
    if (!request.is('application/json')) throw new BadRequestException('JSON content is required.');
    return this.control.recoverConnection();
  }

  @Post('rescan')
  rescan() { return this.control.requestRescan(); }

  @Post('sync-latest')
  syncLatest() { return this.control.syncLatestNow(); }
}
