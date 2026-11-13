import { Body, Controller, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { stationActor, StationAuthorizedRequest } from '@truck-log/server/auth/station';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CreateTruckVisitDto } from './dto/create-truck-visit.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UploadPackingSlipDto } from './dto/upload-packing-slip.dto';
import { WorkflowActionDto } from './dto/workflow-action.dto';
import { DockPackingScanService } from './dock-packing-scan.service';
import { ScanPackingSlipDto, PackingSlipScanTokenDto } from './dto/scan-packing-slip.dto';
import { TruckVisitsService, UploadedPaperworkFile } from './truck-visits.service';

@Controller('visits')
export class TruckVisitsController {
  constructor(private readonly service: TruckVisitsService, private readonly dockScan: DockPackingScanService) {}

  @Get('dashboard')
  dashboard() {
    return this.service.dashboard();
  }

  @Get('dock-board')
  @Header('Cache-Control', 'no-store')
  dockBoard() {
    return this.service.dockBoard();
  }

  @Get('history')
  history(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.history(q, status || 'ALL', date, Number(limit ?? 100));
  }

  @Get()
  listOpen(@Query('q') q?: string) {
    return this.service.listOpen(q);
  }

  // Audit names come from the signed-in station (or administrator), not from the request body.
  @Post()
  create(@Req() req: StationAuthorizedRequest, @Body() dto: CreateTruckVisitDto) {
    dto.actor = stationActor(req, dto.actor);
    return this.service.create(dto);
  }

  @Get('check-in-config')
  checkInConfig() {
    return this.service.checkInConfig();
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  @Patch(':id/dock-complete')
  dockComplete(
    @Req() req: StationAuthorizedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: WorkflowActionDto,
  ) {
    return this.service.markDockComplete(id, stationActor(req, body.actor));
  }

  @Patch(':id/final-checkout')
  finalCheckout(
    @Req() req: StationAuthorizedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: WorkflowActionDto,
  ) {
    return this.service.finalCheckout(id, stationActor(req, body.actor), body.printProof);
  }

  @Post(':id/delivery-number/scan')
  @Header('Cache-Control', 'no-store')
  saveScannedDeliveryNumber(@Param('id', ParseIntPipe) id: number, @Body() body: ScanPackingSlipDto) {
    return this.dockScan.recordDeliveryNumber(id, body.deliveryNumber);
  }

  @Post(':id/delivery-number/manual')
  @Header('Cache-Control', 'no-store')
  saveManualDeliveryNumber(@Param('id', ParseIntPipe) id: number, @Body() body: ScanPackingSlipDto) {
    return this.dockScan.recordDeliveryNumber(id, body.deliveryNumber, 'MANUAL');
  }

  @Post(':id/packing-slip/scan')
  @Header('Cache-Control', 'no-store')
  scanPackingSlip(@Param('id', ParseIntPipe) id: number, @Body() body: ScanPackingSlipDto) {
    return this.dockScan.lookup(id, body.deliveryNumber);
  }

  @Post(':id/packing-slip/scan/preview')
  async previewScannedPackingSlip(@Param('id', ParseIntPipe) id: number,
    @Body() body: PackingSlipScanTokenDto, @Res() response: Response) {
    const result = await this.dockScan.preview(id, body.token);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', 'inline; filename="scanned-packing-slip.pdf"');
    response.setHeader('X-TruckLog-Scan-Preview', result.previewToken);
    response.send(result.buffer);
  }

  @Post(':id/packing-slip/scan/attach')
  @Header('Cache-Control', 'no-store')
  attachScannedPackingSlip(@Param('id', ParseIntPipe) id: number, @Body() body: PackingSlipScanTokenDto) {
    return this.dockScan.attach(id, body.token);
  }

  @Post(':id/packing-slip')
  @UseInterceptors(FileInterceptor('file'))
  addPackingSlip(
    @Req() req: StationAuthorizedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedPaperworkFile,
    @Body() body: UploadPackingSlipDto,
  ) {
    return this.service.addPackingSlip(id, file, stationActor(req, body.actor));
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  addDocument(
    @Req() req: StationAuthorizedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedPaperworkFile,
    @Body() body: UploadDocumentDto,
  ) {
    return this.service.addDocument(id, file, stationActor(req, body.actor), body.documentType);
  }

  @Get(':id/slip')
  @Header('Content-Type', 'text/html; charset=utf-8')
  slip(@Param('id', ParseIntPipe) id: number) {
    return this.service.slipHtml(id);
  }

  @Get('documents/:documentId/download')
  async download(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Res() response: Response,
  ) {
    const { document, stream, checkoutPrintProof } = await this.service.documentFile(documentId);
    if (checkoutPrintProof) response.setHeader('X-TruckLog-Checkout-Print-Proof', checkoutPrintProof);
    const safeFileName = document.fileName.replace(/[\r\n"]/g, '_');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
    response.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
    stream.pipe(response);
  }
}
