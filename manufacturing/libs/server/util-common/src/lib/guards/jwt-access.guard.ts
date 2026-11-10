/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  COLLECTOR_TOKEN_PREFIX,
  COLLECTOR_TOKEN_RESOLVER,
  CollectorTokenResolver,
  collectorTokenAllows,
} from '@gearapps/shared/domain';

import { SKIP_AUTH_KEY, STRATEGY_JWT_ACCESS } from '../constants';
import { TokenExpiredException } from '../exceptions';

@Injectable()
export class JwtAccessTokenGuard extends AuthGuard(STRATEGY_JWT_ACCESS) {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(COLLECTOR_TOKEN_RESOLVER)
    private readonly collectorTokens?: CollectorTokenResolver,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipAuth = this.reflector.getAllAndOverride<boolean>(SKIP_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipAuth) return true;

    const request = context.switchToHttp().getRequest();
    const header = String(request.headers?.authorization ?? '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (bearer.startsWith(COLLECTOR_TOKEN_PREFIX)) {
      // Machine collectors: a revocable token limited to the endpoints a collector needs.
      const user = await this.collectorTokens?.resolve(bearer);
      if (!user) throw new UnauthorizedException('Collector token is invalid or has been revoked');
      if (!collectorTokenAllows(request.method, request.originalUrl ?? request.url ?? ''))
        throw new ForbiddenException('Collector tokens can only send machine data');
      request.user = user;
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }

  override handleRequest(err: any, user: any, info: any) {
    if (info instanceof TokenExpiredException) throw new ForbiddenException('Access token has expired');
    if (err || !user) throw err || new UnauthorizedException('Access token is missing or invalid');
    return user;
  }
}
