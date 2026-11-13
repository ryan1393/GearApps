import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { StationPublic } from '@truck-log/server/auth/station';
import {
  RequireTruckLogAccess,
  TruckLogAccessGuard,
  TruckLogAccessRequest,
  TruckLogAccessScopes,
} from '@truck-log/server/auth/access';
import { RecoverQueuedPrintDto } from '@truck-log/server/domain/driver-print';
import { DockPrintResultDto } from '@truck-log/server/domain/driver-print';
import { ReprintRxoDocumentDto } from '@truck-log/server/domain/driver-print';
import { DriverPrintService } from '@truck-log/server/domain/driver-print';

@Controller()
export class DriverPrintController {
  constructor(private readonly driverPrint: DriverPrintService) {}

  @Get('visits/:visitId/driver-print-package')
  packageForVisit(@Param('visitId', ParseIntPipe) visitId: number) {
    return this.driverPrint.getForVisit(visitId);
  }

  @Get('driver-print/packages/:packageId')
  packageById(@Param('packageId', new ParseUUIDPipe({ version: '4' })) packageId: string) {
    return this.driverPrint.getPackageById(packageId);
  }

  @Post('driver-print/packages/:packageId/dock-result')
  @HttpCode(200)
  dockResult(
    @Param('packageId', new ParseUUIDPipe({ version: '4' })) packageId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-guard-action-key') guardActionKey: string | undefined,
    @Body() body: DockPrintResultDto,
  ) {
    return this.driverPrint.recordDockResult(
      packageId,
      idempotencyKey,
      guardActionKey,
      body,
    );
  }

  @Post('driver-print/packages/:packageId/retry-rxo')
  @HttpCode(200)
  retryRxo(
    @Param('packageId', new ParseUUIDPipe({ version: '4' })) packageId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-guard-action-key') guardActionKey: string | undefined,
  ) {
    return this.driverPrint.retryRxo(packageId, idempotencyKey, guardActionKey);
  }

  @Post('driver-print/packages/:packageId/retry-dock')
  @HttpCode(200)
  retryDock(
    @Param('packageId', new ParseUUIDPipe({ version: '4' })) packageId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-guard-action-key') guardActionKey: string | undefined,
  ) {
    return this.driverPrint.retryDock(packageId, idempotencyKey, guardActionKey);
  }

  @Post('driver-print/packages/:packageId/recover-queued')
  @HttpCode(200)
  recoverQueued(
    @Param('packageId', new ParseUUIDPipe({ version: '4' })) packageId: string,
    @Headers('x-idempotency-key') requestKey: string | undefined,
    @Headers('x-guard-action-key') guardKey: string | undefined,
    @Body() input: RecoverQueuedPrintDto,
  ) {
    return this.driverPrint.recoverQueued(packageId,requestKey,guardKey,input);
  }

  @Post('driver-print/visits/:visitId/reprint-rxo')
  @HttpCode(200)
  @StationPublic()
  @UseGuards(TruckLogAccessGuard)
  @RequireTruckLogAccess(TruckLogAccessScopes.RXO_DOCUMENTS_REPRINT)
  reprintRxo(
    @Req() request: TruckLogAccessRequest,
    @Param('visitId', ParseIntPipe) visitId: number,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ReprintRxoDocumentDto,
  ) {
    if (!request.truckLogPrincipal) {
      throw new UnauthorizedException('Valid Truck Log access credentials are required.');
    }
    return this.driverPrint.reprintRxo(
      visitId,
      request.truckLogPrincipal,
      idempotencyKey,
      body,
    );
  }
}
