import { Module } from '@nestjs/common';
import { SapDocumentsModule } from '@truck-log/server/infrastructure/sap-documents';
import { AutomaticDriverPrintService } from './automatic-driver-print.service';
import { DriverPrintService } from './driver-print.service';

/**
 * Business/persistence boundary for Driver Print Packages.
 *
 * HTTP controllers live in the driver-print feature library. Other server
 * features import this module when they need DriverPrintService without
 * depending on another HTTP feature project.
 */
@Module({
  imports: [SapDocumentsModule],
  providers: [DriverPrintService, AutomaticDriverPrintService],
  exports: [DriverPrintService],
})
export class DriverPrintDomainModule {}
