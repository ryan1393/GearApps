import { Auth, ReqUserId } from '@libs/server/util-common';
import { RoleType, Uuid } from '@libs/shared/util-types';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CreatePartDto, UpdatePartDto } from './part.dto';
import { ServerFeatCutterConfigService } from './server-feat-cutter-config.service';

@Controller({ path: 'parts', version: '1' })
@ApiTags('Parts')
export class ServerPartsController {
  constructor(private readonly service: ServerFeatCutterConfigService) {}

  @Get()
  @Auth([RoleType.ADMIN, RoleType.USER])
  listParts(
    @Query('q') q?: string,
    @Query('summaryId') summaryId?: string,
    @Query('partTypeId') partTypeId?: string,
    @Query('active') active?: string,
    @Query('includeDisabled') includeDisabled?: string,
  ) {
    return this.service.listParts({
      q,
      summaryId,
      partTypeId,
      active,
      includeDisabled,
    });
  }

  @Get('number/:partNumber')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getPartByNumber(@Param('partNumber') partNumber: string) {
    return this.service.getPartByNumber(partNumber);
  }

  @Post()
  @Auth([RoleType.ADMIN])
  createPart(
    @Body() dto: CreatePartDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.createPart(dto, userId);
  }

  @Patch(':id')
  @Auth([RoleType.ADMIN])
  updatePart(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdatePartDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.service.updatePart(id, dto, userId);
  }
}
