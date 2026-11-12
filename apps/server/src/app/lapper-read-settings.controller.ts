import { Controller, ForbiddenException, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { isCollectorPrincipal, ReqUser, RequestUser } from '@meshforge/api/core';
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
  @ApiOperation({
    summary:
      'Argonaut address, sign-in and certificate check for Lapper Read (collector tokens and admins only). ' +
      'Only collector tokens receive the password; administrators see whether one is set.',
  })
  argonautSettings(@ReqUser() user: RequestUser): ArgonautCollectorSettings {
    if (isCollectorPrincipal(user)) return this.argonaut.collectorSettings();
    if (user?.role !== 'admin') {
      throw new ForbiddenException('Only Lapper Read collector tokens and administrators can read the Argonaut settings');
    }
    // The password is never sent to a browser session, even an administrator's.
    const { password, ...rest } = this.argonaut.collectorSettings();
    return { ...rest, password_set: Boolean(password) };
  }
}
