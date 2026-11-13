import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  RequestMethod,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestUser } from './req-user.decorator';

export const COLLECTOR_ONLY_MESSAGE =
  'Only Lapper Read collector tokens and MeshForge administrators can send machine data';
export const ADMIN_ONLY_MESSAGE = 'Only MeshForge administrators can change setup data';

/**
 * The writes a machine collector makes, as `METHOD resource handler-path`. They are matched
 * against the route Nest selected (controller and handler metadata), never the raw request
 * URL, so a query string or encoded path cannot make another route look like one of these.
 */
const COLLECTOR_WRITES = new Set([
  'POST machine-cycle /',
  'POST macro-log /',
  'POST machine-fanuc-variable /',
  // Only a pending gearset (a number with nothing else); see `pendingGearset`.
  'POST gearset /',
  'PATCH machine-fanuc-variable :id',
  'PATCH scanner-detail :id/serial-numbers',
  'PATCH scanner-detail serial-number/:id',
]);

const routePath = (value: unknown): string => {
  const path = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  return '/' + path.replace(/^\/+|\/+$/g, '');
};
const handlerPath = (value: unknown): string => {
  const path = routePath(value);
  return path === '/' ? '/' : path.slice(1);
};

type WriteBody = Partial<
  Record<'ring_id' | 'pinion_id' | 'summary_id' | 'ratio' | 'rev' | 'status' | 'user_id', unknown>
>;

const isPendingGearset = (body: WriteBody): boolean =>
  !body.ring_id &&
  !body.pinion_id &&
  !body.summary_id &&
  body.ratio == null &&
  body.rev == null &&
  String(body.status).toLowerCase() === 'active';

/** Whether the request was made with a collector token (see the access guard). */
export const isCollectorPrincipal = (user: RequestUser | undefined): boolean =>
  !!user && 'collectorTokenId' in user && Boolean((user as { collectorTokenId?: unknown }).collectorTokenId);

/**
 * Lapper write rules: setup data is changed by administrators only, and machine data (cycles,
 * macro values, I/O snapshots, scanner serials, pending gearsets) is sent by collector tokens
 * (Lapper Read) or administrators. Signed-in user accounts may read but not write either.
 */
@Injectable()
export class LapperWritePolicy implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{
      method: string;
      body?: WriteBody;
      user?: RequestUser;
    }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next.handle();
    const resource = handlerPath(this.reflector.get<string>(PATH_METADATA, context.getClass()));
    if (resource === 'auth' || resource === 'users') return next.handle();
    const handler = context.getHandler();
    const method = RequestMethod[this.reflector.get<RequestMethod>(METHOD_METADATA, handler)];
    const route = `${method} ${resource} ${handlerPath(this.reflector.get<string>(PATH_METADATA, handler))}`;
    const body: WriteBody = request.body ?? {};
    const admin = request.user?.role === 'admin' && !isCollectorPrincipal(request.user);
    const collectorWrite =
      COLLECTOR_WRITES.has(route) && (route !== 'POST gearset /' || isPendingGearset(body));
    if (collectorWrite) {
      if (!admin && !isCollectorPrincipal(request.user)) throw new ForbiddenException(COLLECTOR_ONLY_MESSAGE);
    } else if (!admin) {
      throw new ForbiddenException(ADMIN_ONLY_MESSAGE);
    }
    if (request.user && ['gearset', 'part', 'part-summary'].includes(resource))
      body.user_id = request.user.id;
    return next.handle();
  }
}
