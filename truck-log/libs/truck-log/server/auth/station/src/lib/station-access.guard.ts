import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TruckLogAdminService } from '@truck-log/server/auth/admin';
import { StationKinds } from '@truck-log/shared/contracts';
import { STATION_PUBLIC_METADATA, StationAuthorizedRequest } from './station-policy';
import { StationAccessService } from './station-access.service';
import { allowedOrigins, cookieSettings, developmentOpenAccess, originAllowed, stationTokenFromCookie } from './station-security';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * A request from loopback with no proxy headers can only come from a process
 * inside the API container itself (docker exec diagnostics, the healthcheck) or
 * from the same machine in development. Browsers always arrive through nginx or
 * Docker's port proxy, never from loopback.
 */
function fromServerConsole(req: Request): boolean {
  return LOOPBACK.has(req.socket?.remoteAddress || '')
    && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'] && !req.headers.origin;
}

/**
 * Global guard: every API route needs a paired station or a signed-in
 * administrator, unless the route is marked @StationPublic().
 * DISPLAY stations (TV boards) may only read.
 */
@Injectable()
export class StationAccessGuard implements CanActivate {
  private readonly cookie = cookieSettings(process.env);
  private readonly origins = allowedOrigins(process.env);

  constructor(
    private readonly reflector: Reflector,
    private readonly stations: StationAccessService,
    private readonly admin: TruckLogAdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(STATION_PUBLIC_METADATA, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<Request & StationAuthorizedRequest>();
    if (fromServerConsole(req)) {
      req.truckLogAdminName = 'Server console';
      return true;
    }
    if (developmentOpenAccess(process.env)) {
      req.truckLogAdminName = 'Development';
      return true;
    }
    const reading = READ_METHODS.has(req.method);
    if (!reading && !originAllowed(req.headers, this.origins)) {
      throw new HttpException({ code: 'STATION_ORIGIN', message: 'Requests must come from the Truck Log web address.' }, 403);
    }

    const token = stationTokenFromCookie(req.headers.cookie, this.cookie);
    const station = token ? await this.stations.safe(() => this.stations.identify(token)) : null;
    if (station) {
      if (station.kind === StationKinds.DISPLAY && !reading) {
        throw new HttpException({ code: 'STATION_READ_ONLY', message: 'This is a display-only station.' }, 403);
      }
      req.truckLogStation = station;
      return true;
    }

    // No paired station: a signed-in administrator may use the guard screens too.
    try {
      const session = await this.admin.session(req as never);
      req.truckLogAdminName = session.user.displayName || session.user.username;
      return true;
    } catch {
      throw new HttpException({
        code: 'STATION_REQUIRED',
        message: 'This browser is not a registered Truck Log station. Ask an administrator for a pairing code.',
      }, 401);
    }
  }
}
