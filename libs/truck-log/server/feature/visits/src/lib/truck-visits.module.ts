import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dock } from '@truck-log/server/data-access';
import { TruckVisit } from '@truck-log/server/data-access';
import { VisitDocument } from '@truck-log/server/data-access';
import { VisitEvent } from '@truck-log/server/data-access';
import { TruckLogUploadModule } from '@truck-log/server/infrastructure/uploads';
import { TruckVisitsController } from './truck-visits.controller';
import { TruckVisitsService } from './truck-visits.service';
import { DockPackingScanService } from './dock-packing-scan.service';
import { PackingSlipPdfService } from './packing-slip-pdf.service';
import { DriverPrintDomainModule } from '@truck-log/server/domain/driver-print';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dock,
      TruckVisit,
      VisitDocument,
      VisitEvent,
    ]),
    TruckLogUploadModule,
    DriverPrintDomainModule,
  ],
  controllers: [TruckVisitsController],
  providers: [TruckVisitsService, PackingSlipPdfService, DockPackingScanService],
})
export class TruckVisitsModule {}
