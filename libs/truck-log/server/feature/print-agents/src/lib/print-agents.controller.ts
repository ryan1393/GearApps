import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StationPublic } from '@truck-log/server/auth/station';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { DriverPrintService } from '@truck-log/server/domain/driver-print';
import { PrintAgentJobClaimDto } from '@truck-log/server/domain/driver-print';
import { PrintAgentJobResultDto } from '@truck-log/server/domain/driver-print';
import { PrintAgentRequest, PrintAgentScope } from '@truck-log/server/auth/print-agent';
import { PrintAgentAuthGuard } from '@truck-log/server/auth/print-agent';
import { PrintAgentsService } from './print-agents.service';
import { PrintAgentHeartbeatDto } from './dto/print-agent-heartbeat.dto';
import { parsePackingSlipIngestionMetadata } from './dto/packing-slip-ingestion.dto';
import { PackingSlipIngestionService, UploadedPackingSlipFile } from './packing-slip-ingestion.service';
import { PackingSlipRoutesService } from './packing-slip-routes.service';
import { packingSlipEtagMatches } from '@truck-log/shared/contracts';

@Controller('print-agents')
export class PrintAgentsController {
  constructor(
    private readonly printAgents: PrintAgentsService,
    private readonly packingSlips: PackingSlipIngestionService,
    private readonly driverPrint: DriverPrintService,
    private readonly packingSlipRoutes: PackingSlipRoutesService,
  ) {}

  @Post('heartbeat')
  @HttpCode(200)
  @StationPublic()
  @UseGuards(PrintAgentAuthGuard)
  @PrintAgentScope('heartbeat')
  heartbeat(
    @Req() request: PrintAgentRequest,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PrintAgentHeartbeatDto,
  ) {
    if (!request.printAgent) {
      throw new UnauthorizedException('Valid Print Agent credentials are required.');
    }
    return this.printAgents.heartbeat(request.printAgent, idempotencyKey, body);
  }

  // The Print Agent installer reads this before it has a credential (as in 0.1).
  @Get('status')
  @StationPublic()
  status() {
    return this.printAgents.status();
  }

  @Post('documents/packing-slip')
  @HttpCode(200)
  @StationPublic()
  @UseGuards(PrintAgentAuthGuard)
  @PrintAgentScope('documents:upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { files: 1, fields: 1, fileSize: 25 * 1024 * 1024, fieldSize: 64 * 1024 },
  }))
  ingestPackingSlip(
    @Req() request: PrintAgentRequest,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body('metadata') rawMetadata: unknown,
    @UploadedFile() file: UploadedPackingSlipFile | undefined,
  ) {
    if (!request.printAgent) {
      throw new UnauthorizedException('Valid Print Agent credentials are required.');
    }
    return this.packingSlips.ingest(
      request.printAgent,
      idempotencyKey,
      parsePackingSlipIngestionMetadata(rawMetadata),
      file,
    );
  }

  // The SAP watcher's route settings (configured in Administration > Printing).
  // Same credential as the packing-slip upload. ETag is the version; If-None-Match -> 304.
  @Get('packing-slip-routes')
  @StationPublic()
  @UseGuards(PrintAgentAuthGuard)
  @PrintAgentScope('documents:upload')
  async packingSlipRouteConfig(
    @Req() request: PrintAgentRequest,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!request.printAgent) {
      throw new UnauthorizedException('Valid Print Agent credentials are required.');
    }
    const config = await this.packingSlipRoutes.current();
    response.setHeader('ETag', `"${config.version}"`);
    response.setHeader('Cache-Control', 'no-cache');
    if (packingSlipEtagMatches(ifNoneMatch, config.version)) {
      response.status(304).end();
      return;
    }
    response.status(200).json(config);
  }

  @Post('jobs/claim')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @StationPublic()
  @UseGuards(PrintAgentAuthGuard)
  @PrintAgentScope('print-jobs:poll')
  claimJob(
    @Req() request: PrintAgentRequest,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PrintAgentJobClaimDto,
  ) {
    if (!request.printAgent) {
      throw new UnauthorizedException('Valid Print Agent credentials are required.');
    }
    return this.driverPrint.claimAgentJob(request.printAgent, idempotencyKey, body);
  }

  @Get('jobs/:itemId/document')
  @StationPublic()
  @UseGuards(PrintAgentAuthGuard)
  @PrintAgentScope('documents:download')
  async downloadJobDocument(
    @Req() request: PrintAgentRequest,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Headers('x-print-claim-token') claimToken: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!request.printAgent) {
      throw new UnauthorizedException('Valid Print Agent credentials are required.');
    }
    const document = await this.driverPrint.documentForAgent(
      request.printAgent,
      itemId,
      claimToken,
    );
    const safeFileName = document.fileName
      .replace(/[\r\n"\\/]/g, '_')
      .replace(/[^\x20-\x7e]/g, '_');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFileName || 'rxo-driver-document.pdf'}"`,
    );
    response.setHeader('Content-Length', String(document.fileSizeBytes));
    response.setHeader('X-Document-SHA256', document.sha256);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    await pipeline(document.stream, response);
  }

  @Post('jobs/:itemId/result')
  @HttpCode(200)
  @StationPublic()
  @UseGuards(PrintAgentAuthGuard)
  @PrintAgentScope('print-jobs:report')
  reportJobResult(
    @Req() request: PrintAgentRequest,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PrintAgentJobResultDto,
  ) {
    if (!request.printAgent) {
      throw new UnauthorizedException('Valid Print Agent credentials are required.');
    }
    return this.driverPrint.recordAgentResult(
      request.printAgent,
      itemId,
      idempotencyKey,
      body,
    );
  }

  @Get('gate-routing')
  @StationPublic()
  @Header('Cache-Control', 'no-store')
  gateRouting() {
    return this.driverPrint.getGateRoutingStatus();
  }

  @Get('setup-check')
  @Header('Cache-Control', 'no-store')
  @StationPublic()
  @UseGuards(PrintAgentAuthGuard)
  @PrintAgentScope('heartbeat')
  setupCheck(@Req() request: PrintAgentRequest) {
    const required = ['heartbeat', 'print-jobs:poll', 'documents:download', 'print-jobs:report'];
    if (!request.printAgent || !required.every(scope => request.printAgent!.scopes.includes(scope))) {
      throw new UnauthorizedException('This agent requires heartbeat, polling, download, and report permissions.');
    }
    return {accepted: true, contract: 'truck-log-dual-gate-v1', agentId: request.printAgent.agentId, permissionsVerified: true};
  }
}
