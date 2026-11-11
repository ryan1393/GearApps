import { Body, Controller, Get, Post, Put, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Auth, ReqUserId } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';
import { CoaterRpaPartKeyDto, CoaterRpaPartMapDto, CoaterRpaSettingsDto } from './coater-rpa-admin.dto';
import { CoaterRpaAdminService, RPA_FORM_MAX_BYTES } from './coater-rpa-admin.service';

/** Admin > Coater RPA. Administrators only: the form and its recipients decide what is sent to the coater. */
@Controller({ path: 'admin/coater-rpa', version: '1' })
@ApiTags('Coater RPA setup')
export class CoaterRpaAdminController {
  constructor(private readonly rpa: CoaterRpaAdminService) {}

  @Get() @Auth([RoleType.ADMIN])
  setup() { return this.rpa.setup(); }

  @Put('settings') @Auth([RoleType.ADMIN])
  saveSettings(@Body() dto: CoaterRpaSettingsDto, @ReqUserId() user: Uuid) { return this.rpa.saveSettings(dto, user); }

  @Post('form') @Auth([RoleType.ADMIN])
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RPA_FORM_MAX_BYTES, files: 1 } }))
  uploadForm(@UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @ReqUserId() user: Uuid) {
    return this.rpa.uploadForm(file, user);
  }

  @Get('form') @Auth([RoleType.ADMIN])
  async form() {
    const form = await this.rpa.form();
    return new StreamableFile(form.document, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${form.file_name.replace(/[^\w .()-]/g, '_')}"`,
    });
  }

  @Put('part-map') @Auth([RoleType.ADMIN])
  saveMapping(@Body() dto: CoaterRpaPartMapDto) { return this.rpa.saveMapping(dto); }

  @Post('part-map/remove') @Auth([RoleType.ADMIN])
  removeMapping(@Body() dto: CoaterRpaPartKeyDto) { return this.rpa.removeMapping(dto.summary, dto.part_type); }
}
