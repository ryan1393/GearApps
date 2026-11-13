import { Body, Controller, Get, Header, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TruckLogAdminService, TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import type { PackingSlipRouteConfig } from '@truck-log/shared/contracts';
import { PackingSlipRoutesService } from './packing-slip-routes.service';

/**
 * Administration > Printing > Packing slip watcher.
 * GET follows the gate printer settings: any paired station or administrator may read it
 * (the webpage shows it read-only without an administrator). PUT needs an administrator
 * session and the CSRF header (TruckLogAdminWrites), and records who saved.
 */
@TruckLogAdminWrites()
@Controller('admin/packing-slip-routes')
export class PackingSlipRoutesAdminController {
  constructor(private readonly routes: PackingSlipRoutesService, private readonly admin: TruckLogAdminService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  read(): Promise<PackingSlipRouteConfig> {
    return this.routes.current();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  async save(@Req() req: Request, @Body() body: unknown): Promise<PackingSlipRouteConfig> {
    // The write guard already verified the session and CSRF; this resolves the name for the audit row.
    const actor = await this.admin.safe(() => this.admin.authorize(req as never, false));
    return this.routes.save(body, actor.user.username);
  }
}
