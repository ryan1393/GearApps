import { GEAR_APPS_VERSION } from '@gearapps/manufacturing/shared/util-constants';
import { SkipAuth } from '@gearapps/manufacturing/server/util-common';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@Controller({ path: 'health', version: '1' })
@ApiTags('Health')
export class ServerFeatureHealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
  ) {}

  @Get('live')
  @SkipAuth()
  live() {
    return { status: 'ok', service: 'gear-app-server', version: GEAR_APPS_VERSION };
  }

  @Get('ready')
  @HealthCheck()
  @SkipAuth()
  ready() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }

  @Get()
  @HealthCheck()
  @SkipAuth()
  check() {
    return this.ready();
  }
}
