import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { RequestUser } from './req-user.decorator';

@Injectable()
export class LapperWritePolicy implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{
      method: string;
      originalUrl: string;
      body?: Record<string, unknown>;
      user?: RequestUser;
    }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next.handle();
    const resource = this.reflector.get<string>(PATH_METADATA, context.getClass());
    if (resource === 'auth' || resource === 'users') return next.handle();
    const body = request.body ?? {};
    const pendingGearset =
      resource === 'gearset' &&
      !body.ring_id &&
      !body.pinion_id &&
      !body.summary_id &&
      body.ratio == null &&
      body.rev == null &&
      String(body.status).toLowerCase() === 'active';
    const ingestion =
      request.method === 'POST' &&
      (['machine-cycle', 'macro-log', 'machine-fanuc-variable'].includes(resource) ||
        pendingGearset);
    const snapshot = request.method === 'PATCH' && resource === 'machine-fanuc-variable';
    const serials =
      request.method === 'PATCH' &&
      resource === 'scanner-detail' &&
      (/\/serial-numbers(?:\?|$)/.test(request.originalUrl) ||
        /\/serial-number\//.test(request.originalUrl));
    if (!ingestion && !snapshot && !serials && request.user?.role !== 'admin') {
      throw new ForbiddenException('Only MeshForge administrators can change setup data');
    }
    if (request.user && ['gearset', 'part', 'part-summary'].includes(resource))
      body.user_id = request.user.id;
    return next.handle();
  }
}
