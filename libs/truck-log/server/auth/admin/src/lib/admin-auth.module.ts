import { Body, CanActivate, Controller, ExecutionContext, Get, Header, Injectable, Module, Param, Patch, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { TruckLogAdminService } from './admin-auth.service';
import { AdminRequest, ADMIN_VERSION, sessionCookie, clearCookie, header, fail } from './admin-security';

import { ADMIN_WRITE_METADATA } from './admin-policy';
@Injectable()
export class TruckLogAdminWriteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: TruckLogAdminService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const marked = this.reflector.getAllAndOverride<boolean>(ADMIN_WRITE_METADATA, [context.getHandler(), context.getClass()]);
    if (!marked) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return true;
    await this.auth.safe(() => this.auth.authorize(req as AdminRequest, false, context.getClass().name + '.' + context.getHandler().name));
    return true;
  }
}
function jsonOnly(req: Request) {
  if (header(req as AdminRequest, 'content-type').split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'ADMIN_JSON_REQUIRED', 'A JSON request is required.');
}
// Same key as StationPublic() in @truck-log/server/auth/station (that library depends on this one).
// Sign-in must work before a browser is a paired station.
@SetMetadata('truck-log:station-public', true)
@Controller('admin-auth')
export class TruckLogAdminController {
  constructor(private readonly auth: TruckLogAdminService) {}
  @Get('status') @Header('Cache-Control', 'no-store')
  status() { return this.auth.configStatus(); }
  @Get('session') @Header('Cache-Control', 'no-store')
  session(@Req() req: Request) { return this.auth.safe(() => this.auth.session(req as AdminRequest)); }
  @Post('login') @Header('Cache-Control', 'no-store')
  login(@Req() req: Request, @Body() values: unknown, @Res({ passthrough: true }) res: Response) {
    return this.auth.safe(async () => {
      jsonOnly(req);
      const result = await this.auth.login(req as AdminRequest, values);
      res.setHeader('Set-Cookie', sessionCookie(result.token, this.auth.cookieTransport()));
      return result.session; // Session token is never returned in JSON.
    });
  }
  @Post('logout') @Header('Cache-Control', 'no-store')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.safe(async () => {
      jsonOnly(req); await this.auth.logout(req as AdminRequest);
      res.setHeader('Set-Cookie', clearCookie(this.auth.cookieTransport())); return { signedOut: true };
    });
  }
  @Post('password') @Header('Cache-Control', 'no-store')
  password(@Req() req: Request, @Body() values: unknown, @Res({ passthrough: true }) res: Response) {
    return this.auth.safe(async () => {
      jsonOnly(req); await this.auth.changePassword(req as AdminRequest, values);
      res.setHeader('Set-Cookie', clearCookie(this.auth.cookieTransport())); return { changed: true, signInRequired: true };
    });
  }
  @Get('users') @Header('Cache-Control', 'no-store')
  users(@Req() req: Request) { return this.auth.safe(() => this.auth.list(req as AdminRequest)); }
  @Post('users') @Header('Cache-Control', 'no-store')
  create(@Req() req: Request, @Body() values: unknown) {
    return this.auth.safe(() => { jsonOnly(req); return this.auth.create(req as AdminRequest, values); });
  }
  @Patch('users/:id') @Header('Cache-Control', 'no-store')
  update(@Req() req: Request, @Param('id') id: string, @Body() values: unknown) {
    return this.auth.safe(() => { jsonOnly(req); return this.auth.update(req as AdminRequest, id, values); });
  }
  @Post('users/:id/reset-password') @Header('Cache-Control', 'no-store')
  reset(@Req() req: Request, @Param('id') id: string, @Body() values: unknown) {
    return this.auth.safe(async () => { jsonOnly(req); await this.auth.reset(req as AdminRequest, id, values); return { reset: true, mustChangePassword: true }; });
  }
}
@Module({
  controllers: [TruckLogAdminController],
  providers: [TruckLogAdminService, { provide: APP_GUARD, useClass: TruckLogAdminWriteGuard }],
  exports: [TruckLogAdminService],
})
export class TruckLogAdminModule { readonly version = ADMIN_VERSION; }
