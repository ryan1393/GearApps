import { Auth, ReqUserId } from '@gearapps/manufacturing/server/util-common';
import { RoleType, Uuid } from '@gearapps/manufacturing/shared/util-types';
import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { LabelPrinterChoicesQueryDto, SaveLabelPrinterDto } from './label-printer.dto';
import { LabelPrinterService } from './label-printer.service';

@Controller({ path: 'label-printers', version: '1' })
@ApiTags('Label Printers')
export class LabelPrinterController {
  constructor(private readonly printers: LabelPrinterService) {}

  /** The printers an operator may print one kind of label to, and which is the default. */
  @Get()
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN, RoleType.USER])
  choices(@Query() query: LabelPrinterChoicesQueryDto) {
    return this.printers.choices(query.label_type);
  }

  @Get('admin')
  @Header('Cache-Control', 'no-store')
  @Auth([RoleType.ADMIN])
  adminList() {
    return this.printers.adminList();
  }

  @Post()
  @Auth([RoleType.ADMIN])
  create(@Body() dto: SaveLabelPrinterDto, @ReqUserId() userId: Uuid) {
    return this.printers.create(dto, userId);
  }

  @Put(':id')
  @Auth([RoleType.ADMIN])
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SaveLabelPrinterDto, @ReqUserId() userId: Uuid) {
    return this.printers.update(id, dto, userId);
  }

  @Delete(':id')
  @Auth([RoleType.ADMIN])
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.printers.remove(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Auth([RoleType.ADMIN])
  test(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.printers.test(id);
  }
}
