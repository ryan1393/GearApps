import { DepartmentAppEdit, Auth } from '@gearapps/manufacturing/server/util-common';
import { RoleType } from '@gearapps/manufacturing/shared/util-types';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { PrintAssetTagDto } from './asset-tag-print.dto';
import { ServerFeatAssetTagService } from './server-feat-asset-tag.service';

@Controller({ path: 'asset-tags', version: '1' })
@ApiTags('Asset Tags')
export class ServerFeatAssetTagController {
  constructor(private readonly assetTagService: ServerFeatAssetTagService) {}

  @Post('print')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiOkResponse({ description: 'Sends a native IPL Code 128 tag or returns the .prn payload as a fallback.' })
  async printTag(@Body() dto: PrintAssetTagDto) {
    return this.assetTagService.printTag(dto);
  }
}
