import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TruckLogAdminService } from '@truck-log/server/auth/admin';
import { STATION_KIND_LABELS, StationKinds, type StationIdentity } from '@truck-log/shared/contracts';
import { STATION_PUBLIC_METADATA, StationAuthorizedRequest } from './station-policy';
import { StationAccessService } from './station-access.service';
import { stationRoleDecision } from './station-roles';
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
 * The station's kind is its role (station-roles.ts): DISPLAY and MANAGEMENT
 * stations may only read; DOCK handhelds may only do dock work. A signed-in
 * administrator on the same browser overrides those limits.
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
      const decision = stationRoleDecision(station.kind, req.method, req.path || req.url);
      if (decision !== 'ALLOW' && !(await this.administratorSignedIn(req))) {
        throw this.refusal(decision, station);
      }
      req.truckLogStation = station;
      return true;
    }

    // No paired station: a signed-in administrator may use the guard screens too.
    // (A browser with a paired station reaches this only when the station is unknown or revoked.)
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

  /** True when an administrator is also signed in on this browser; records who for the audit trail. */
  private async administratorSignedIn(req: Request & StationAuthorizedRequest): Promise<boolean> {
    try {
      const session = await this.admin.session(req as never);
      req.truckLogAdminName = session.user.displayName || session.user.username;
      return true;
    } catch {
      return false;
    }
  }

  private refusal(decision: 'READ_ONLY' | 'ROLE', station: StationIdentity): HttpException {
    if (decision === 'READ_ONLY') {
      const what = station.kind === StationKinds.MANAGEMENT ? 'a view-only management station' : 'a display-only station';
      return new HttpException({ code: 'STATION_READ_ONLY', message: `This is ${what}.` }, 403);
    }
    return new HttpException({
      code: 'STATION_ROLE',
      message: `This ${STATION_KIND_LABELS[station.kind]?.toLowerCase() || 'station'} can only use the Dock Board and Records & Paperwork.`,
    }, 403);
  }
}
