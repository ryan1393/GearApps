import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StationPublic } from '@truck-log/server/auth/station';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  TruckLogAccessGuard,
  TruckLogAccessScope,
  TruckLogAccessScopes,
  type TruckLogAccessRequest,
} from '@truck-log/server/auth/access';
import {
  RxoDocumentsService,
  type UploadedRxoDriverDocumentFile,
} from './rxo-documents.service';

import { RxoBrowserUploadGuard } from './rxo-browser-upload.guard';
import { MAX_RXO_PDF_BYTES } from './rxo-document-pdf-validation';

function contentDisposition(fileName: string): string {
  const safeAscii = String(fileName || 'rxo-driver-document.pdf')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\\r\n]/g, '_')
    .slice(0, 255) || 'rxo-driver-document.pdf';
  const encoded = encodeURIComponent(fileName || 'rxo-driver-document.pdf')
    .replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

@Controller('rxo-documents')
export class RxoDocumentsController {
  constructor(private readonly documents: RxoDocumentsService) {}

  @Get(':siteKey/:direction/:shipmentId')
  @StationPublic()
  @UseGuards(TruckLogAccessGuard)
  @TruckLogAccessScope()
  status(
    @Req() request: TruckLogAccessRequest,
    @Param('siteKey') siteKey: string,
    @Param('direction') direction: string,
    @Param('shipmentId') shipmentId: string,
    @Query('historyBeforeVersion') historyBeforeVersion?: string,
    @Query('historyLimit') historyLimit?: string,
  ) {
    this.requireDocumentReadAccess(request);
    return this.documents.status(
      siteKey,
      direction,
      shipmentId,
      historyBeforeVersion,
      historyLimit,
    );
  }

  @Post(':siteKey/:direction/:shipmentId')
  @HttpCode(200)
  @StationPublic()
  @UseGuards(TruckLogAccessGuard)
  @TruckLogAccessScope(TruckLogAccessScopes.RXO_DOCUMENTS_WRITE)
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      files: 1,
      fields: 0,
      fileSize: MAX_RXO_PDF_BYTES,
    },
  }))
  upload(
    @Req() request: TruckLogAccessRequest,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param('siteKey') siteKey: string,
    @Param('direction') direction: string,
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file: UploadedRxoDriverDocumentFile | undefined,
  ) {
    if (!request.truckLogPrincipal) {
      throw new UnauthorizedException(
        'Valid Truck Log access credentials are required.',
      );
    }
    return this.documents.upload(
      request.truckLogPrincipal,
      idempotencyKey,
      siteKey,
      direction,
      shipmentId,
      file,
    );
  }

  /** Passwordless in-app upload only; token-authenticated integrations stay unchanged. */
  @Post(':siteKey/:direction/:shipmentId/browser-upload')
  @HttpCode(200)
  @UseGuards(RxoBrowserUploadGuard)
  @UseInterceptors(FileInterceptor('file', {
    limits: { files: 1, fields: 0, fileSize: MAX_RXO_PDF_BYTES },
  }))
  uploadFromBrowser(
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param('siteKey') siteKey: string,
    @Param('direction') direction: string,
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file: UploadedRxoDriverDocumentFile | undefined,
  ) {
    return this.documents.uploadFromBrowser(idempotencyKey, siteKey, direction, shipmentId, file);
  }

  @Get(':documentId/download')
  @StationPublic()
  @UseGuards(TruckLogAccessGuard)
  @TruckLogAccessScope()
  async download(
    @Req() request: TruckLogAccessRequest,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.requireDocumentReadAccess(request);
    if (!documentId) throw new BadRequestException('documentId is required.');

    const download = await this.documents.download(documentId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', 'sandbox');
    response.setHeader('Content-Disposition', contentDisposition(download.fileName));
    return new StreamableFile(download.buffer, {
      type: 'application/pdf',
      length: download.fileSizeBytes,
    });
  }

  private requireDocumentReadAccess(request: TruckLogAccessRequest): void {
    const principal = request.truckLogPrincipal;
    if (!principal) {
      throw new UnauthorizedException(
        'Valid Truck Log access credentials are required.',
      );
    }
    if (
      !principal.scopes.includes(TruckLogAccessScopes.RXO_DOCUMENTS_WRITE)
      && !principal.scopes.includes(TruckLogAccessScopes.RXO_DOCUMENTS_REPRINT)
    ) {
      throw new ForbiddenException(
        'RXO document write or reprint scope is required for direct document access.',
      );
    }
  }
}
