import { LapperWritePolicy, CrudService, crudController } from '@gearapps/api/core';
import {
  CreateScannerDetailDto,
  ScannerDetailDto,
  UpdateScannerDetailDto,
  UpdateScannerSerialNumbersDto,
} from '@gearapps/api/data-access';
import { ScannerDetail } from '@gearapps/shared/domain';
import {
  UseInterceptors,
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
@Injectable()
export abstract class ScannerDetailsService extends CrudService<ScannerDetail> {
  abstract findByIp(ip: string): Promise<ScannerDetail>;
  abstract findByMachine(machineId: string): Promise<ScannerDetail>;
}
@UseInterceptors(LapperWritePolicy)
@Controller({ path: 'scanner-detail', version: '1' })
@ApiTags('Gear · Scanners')
@ApiBearerAuth()
export class ScannerDetailsController extends crudController<ScannerDetail>({
  entity: ScannerDetailDto,
  create: CreateScannerDetailDto,
  update: UpdateScannerDetailDto,
  name: 'scanner',
}) {
  constructor(override readonly service: ScannerDetailsService) {
    super();
  }
  @Get('ip/:ip')
  @ApiOperation({ summary: 'Find a scanner by IP address' })
  @ApiOkResponse({ type: ScannerDetailDto })
  findByIp(
    @Param('ip')
    ip: string,
  ): Promise<ScannerDetail> {
    return this.service.findByIp(ip);
  }
  @Get('machine/:machineId')
  @ApiOperation({ summary: 'Scanner assigned to a machine' })
  @ApiOkResponse({ type: ScannerDetailDto })
  findByMachine(
    @Param('machineId', ParseUUIDPipe)
    machineId: string,
  ): Promise<ScannerDetail> {
    return this.service.findByMachine(machineId);
  }
  /** Used by the scanner data-collector to push the three serial-number slots. */
  @Patch(':id/serial-numbers')
  @ApiOperation({ summary: 'Update in-scanner / in-queue / in-process serial numbers' })
  @ApiOkResponse({ type: ScannerDetailDto })
  updateSerialNumbers(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: UpdateScannerSerialNumbersDto,
  ): Promise<ScannerDetail> {
    return this.service.update(id, body);
  }
  /** Legacy path kept for existing collectors. */
  @Patch('serial-number/:id')
  @ApiOperation({ summary: 'Legacy alias of PATCH :id/serial-numbers', deprecated: true })
  @ApiOkResponse({ type: ScannerDetailDto })
  updateSerialNumbersLegacy(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: UpdateScannerSerialNumbersDto,
  ): Promise<ScannerDetail> {
    return this.service.update(id, body);
  }
}
