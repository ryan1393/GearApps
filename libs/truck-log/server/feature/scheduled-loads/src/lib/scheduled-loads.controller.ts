import { TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import { Controller, Get, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ScheduledLoadsService, UploadedScheduleWorkbook } from './scheduled-loads.service';

@TruckLogAdminWrites()
@Controller('scheduled-loads')
export class ScheduledLoadsController {
  constructor(private readonly scheduledLoads: ScheduledLoadsService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.scheduledLoads.listActive(Number(limit ?? 500));
  }

  @Get('lookup')
  lookup(@Query('loadNumber') loadNumber?: string) {
    return this.scheduledLoads.lookup(loadNumber);
  }

  @Get('template')
  async template(@Res() response: Response) {
    const workbook = await this.scheduledLoads.templateWorkbook();
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="Scheduled-Loads-Import-Template.xlsx"');
    response.send(workbook);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  importWorkbook(@UploadedFile() file: UploadedScheduleWorkbook) {
    return this.scheduledLoads.importWorkbook(file);
  }
}
