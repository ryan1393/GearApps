import { DepartmentAppEdit, Auth } from '@gearapps/manufacturing/server/util-common';
import { RoleType } from '@gearapps/manufacturing/shared/util-types';
import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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

  @Post('test-print/:printerId')
  @HttpCode(200)
  @Auth([RoleType.ADMIN])
  @ApiOkResponse({ description: 'Prints a tag reading TEST on one printer, to check its language and alignment.' })
  async printTestTag(@Param('printerId', new ParseUUIDPipe()) printerId: string) {
    return this.assetTagService.printTestTag(printerId);
  }
}
