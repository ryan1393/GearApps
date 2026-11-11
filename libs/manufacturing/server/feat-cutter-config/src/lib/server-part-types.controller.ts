import { Auth } from '@meshforge/manufacturing/server/util-common';
import { RoleType } from '@meshforge/manufacturing/shared/util-types';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ServerFeatCutterConfigService } from './server-feat-cutter-config.service';

@Controller({ path: 'part-types', version: '1' })
@ApiTags('Part Types')
export class ServerPartTypesController {
  constructor(private readonly service: ServerFeatCutterConfigService) {}

  @Get()
  @Auth([RoleType.ADMIN, RoleType.USER])
  listPartTypes() {
    return this.service.listPartTypes();
  }
}
