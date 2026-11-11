import {
  ApiPageOkResponse,
  CreatePartSummaryDto,
  PaginationOptionsDto,
  PartSummaryDto,
  UpdatePartSummaryDto,
} from '@meshforge/manufacturing/server/data-access';
import { Auth, ReqUserId, UUIDParam } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ServerFeatPartSummaryService } from './server-feat-part-summary.service';


@Controller({ path: 'part-summaries', version: '1' })
@ApiTags('Part Summaries')
export class ServerFeatPartSummaryController {
  private readonly logger = new Logger(ServerFeatPartSummaryController.name);
  constructor(private partSummaryService: ServerFeatPartSummaryService) { }

  @Post('')
  @ApiCreatedResponse({
    type: PartSummaryDto,
  })
  @Auth([RoleType.ADMIN])
  async createPartSummary(
    @Body() dto: CreatePartSummaryDto,
    @ReqUserId() userId: Uuid,
  ) {
    return this.partSummaryService.createPartSummary(dto, userId);
  }

  @Get('')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiPageOkResponse({ type: PartSummaryDto })
  async getPartSummarys(@Query() paginationOptions: PaginationOptionsDto) {
    return this.partSummaryService.getPartSummaries(paginationOptions);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN, RoleType.USER])
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: PartSummaryDto,
  })
  async getPartSummary(@Param('id', new ParseUUIDPipe()) partSummaryId: Uuid) {
    return this.partSummaryService.getPartSummary(partSummaryId);
  }

  @Patch(':id')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: PartSummaryDto,
  })
  @Auth([RoleType.ADMIN])
  async updatePartSummary(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @Body() dto: UpdatePartSummaryDto,
    @ReqUserId() userId: Uuid,
  ) {
    this.logger.debug(`Updating part-summary ${id}`);
    return this.partSummaryService.updatePartSummary(id, dto, userId);
  }

  @Delete(':id')
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
  })
  @ApiOkResponse({
    type: PartSummaryDto,
  })
  @Auth([RoleType.ADMIN])
  async deletePartSummary(
    @Param('id', new ParseUUIDPipe()) id: Uuid,
    @ReqUserId() userId: Uuid,
  ) {
    return this.partSummaryService.deletePartSummary(id, userId);
  }
}
