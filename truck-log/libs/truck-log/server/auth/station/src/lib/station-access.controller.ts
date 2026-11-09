import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TruckLogAdminService } from '@truck-log/server/auth/admin';
import type { StationPairingResult, StationRecord, StationSession } from '@truck-log/shared/contracts';
import { StationPublic } from './station-policy';
import { StationAccessService } from './station-access.service';
import { allowedOrigins, clearStationCookie, cookieSettings, developmentOpenAccess, originAllowed, stationCookie, stationFail, stationTokenFromCookie } from './station-security';

function clientAddress(req: Request): string {
  // Pairing limits must not trust addresses supplied to the public API by a client.
  return req.socket.remoteAddress || 'unknown';
}

/** Station side: is this browser paired, pair it, unpair it. No sign-in needed. */
@Controller('station-access')
@StationPublic()
export class StationAccessController {
  private readonly cookie = cookieSettings(process.env);
  private readonly origins = allowedOrigins(process.env);

  constructor(private readonly stations: StationAccessService, private readonly admin: TruckLogAdminService) {}

  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(@Req() req: Request): Promise<StationSession> {
    const token = stationTokenFromCookie(req.headers.cookie, this.cookie);
    const station = token ? await this.stations.safe(() => this.stations.identify(token)) : null;
    // Development open access behaves like an administrator session for the web app.
    let admin = developmentOpenAccess(process.env);
    if (!admin) { try { await this.admin.session(req as never); admin = true; } catch { admin = false; } }
    return { station, admin };
  }

  @Post('pair')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  pair(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<StationSession> {
    return this.stations.safe(async () => {
      if (!originAllowed(req.headers, this.origins)) stationFail(403, 'STATION_ORIGIN', 'Pair from the Truck Log web address.');
      const { token, station } = await this.stations.pair(body, clientAddress(req));
      res.setHeader('Set-Cookie', stationCookie(token, this.cookie));
      return { station, admin: false };
    });
  }

  @Post('sign-out')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    return this.stations.safe(async () => {
      if (!originAllowed(req.headers, this.origins)) stationFail(403, 'STATION_ORIGIN', 'Use the Truck Log web address.');
      const token = stationTokenFromCookie(req.headers.cookie, this.cookie);
      if (token) await this.stations.signOut(token, clientAddress(req));
      res.setHeader('Set-Cookie', clearStationCookie(this.cookie));
    });
  }
}

/** Administrator side: register stations, issue pairing codes, revoke. Admin session required for every route. */
@Controller('stations')
@StationPublic()
export class StationsAdminController {
  constructor(private readonly stations: StationAccessService, private readonly admin: TruckLogAdminService) {}

  private async actor(req: Request, route: string): Promise<string> {
    const actor = await this.admin.safe(() => this.admin.authorize(req as never, false, `StationsAdmin.${route}`));
    return actor.user.username;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() req: Request): Promise<StationRecord[]> {
    await this.actor(req, 'list');
    return this.stations.safe(() => this.stations.list());
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@Req() req: Request, @Body() body: unknown): Promise<StationPairingResult> {
    const actor = await this.actor(req, 'create');
    return this.stations.safe(() => this.stations.create(body, actor));
  }

  @Post(':id/pairing-code')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async reissue(@Req() req: Request, @Param('id') id: string): Promise<StationPairingResult> {
    const actor = await this.actor(req, 'reissue');
    return this.stations.safe(() => this.stations.reissue(id, actor));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(@Req() req: Request, @Param('id') id: string): Promise<StationRecord> {
    const actor = await this.actor(req, 'revoke');
    return this.stations.safe(() => this.stations.revoke(id, actor));
  }
}
