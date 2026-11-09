import { BaseCrudService, crudController } from '@gearapps/api/core';
import {
  CreateScannerDetailDto,
  ScannerDetailDto,
  ScannerDetailEntity,
  UpdateScannerDetailDto,
  UpdateScannerSerialNumbersDto,
} from '@gearapps/api/data-access';
import { ScannerDetail } from '@gearapps/shared/domain';
import {
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class ScannerDetailsService extends BaseCrudService<ScannerDetail> {
  protected override readonly relations = { machine: true };

  constructor(@InjectRepository(ScannerDetailEntity) repo: Repository<ScannerDetail>) {
    super(repo, 'Scanner');
  }

  async findByIp(ip: string): Promise<ScannerDetail> {
    const scanner = await this.repo.findOne({ where: { ip }, relations: this.relations });
    if (!scanner) throw new NotFoundException(`Scanner with IP ${ip} not found`);
    return scanner;
  }

  async findByMachine(machineId: string): Promise<ScannerDetail> {
    const scanner = await this.repo.findOne({
      where: { machine_id: machineId },
      relations: this.relations,
    });
    if (!scanner) throw new NotFoundException(`No scanner assigned to machine ${machineId}`);
    return scanner;
  }
}

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
  findByIp(@Param('ip') ip: string): Promise<ScannerDetail> {
    return this.service.findByIp(ip);
  }

  @Get('machine/:machineId')
  @ApiOperation({ summary: 'Scanner assigned to a machine' })
  @ApiOkResponse({ type: ScannerDetailDto })
  findByMachine(@Param('machineId', ParseUUIDPipe) machineId: string): Promise<ScannerDetail> {
    return this.service.findByMachine(machineId);
  }

  /** Used by the scanner data-collector to push the three serial-number slots. */
  @Patch(':id/serial-numbers')
  @ApiOperation({ summary: 'Update in-scanner / in-queue / in-process serial numbers' })
  @ApiOkResponse({ type: ScannerDetailDto })
  updateSerialNumbers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateScannerSerialNumbersDto,
  ): Promise<ScannerDetail> {
    return this.service.update(id, body);
  }

  /** Legacy path kept for existing collectors. */
  @Patch('serial-number/:id')
  @ApiOperation({ summary: 'Legacy alias of PATCH :id/serial-numbers', deprecated: true })
  @ApiOkResponse({ type: ScannerDetailDto })
  updateSerialNumbersLegacy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateScannerSerialNumbersDto,
  ): Promise<ScannerDetail> {
    return this.service.update(id, body);
  }
}
