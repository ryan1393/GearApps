import { Controller, ForbiddenException, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqUser, RequestUser } from '@meshforge/api/core';
import { Auth } from '@meshforge/manufacturing/server/util-common';
import { ArgonautCollectorSettings } from '@meshforge/shared/domain';
import { ArgonautTestService } from './argonaut-test.service';

/** Settings Lapper Read takes from Admin > Server Settings instead of only its .env. */
@Controller({ path: 'lapper-read', version: '1' })
@ApiTags('Lapper Read collector')
export class LapperReadSettingsController {
  constructor(private readonly argonaut: ArgonautTestService) {}

  @Get('argonaut')
  @Auth()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "Argonaut address, sign-in and certificate check for Lapper Read (collector tokens and admins only)" })
  argonautSettings(@ReqUser() user: RequestUser): ArgonautCollectorSettings {
    // Includes the Argonaut password: only a collector token or an administrator may read it.
    const collector = !!user && 'collectorTokenId' in user;
    if (!collector && user?.role !== 'admin') {
      throw new ForbiddenException('Only Lapper Read collector tokens and administrators can read the Argonaut settings');
    }
    return this.argonaut.collectorSettings();
  }
}
