import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TruckLogAccessModule } from '@truck-log/server/auth/access';
import { DriverPrintDomainModule } from '@truck-log/server/domain/driver-print';
import { TruckLogUploadModule } from '@truck-log/server/infrastructure/uploads';
import { SapDocumentsModule } from '@truck-log/server/infrastructure/sap-documents';
import { RxoDocumentsController } from './rxo-documents.controller';
import { RxoDocumentsService } from './rxo-documents.service';
import { RxoBrowserUploadGuard } from './rxo-browser-upload.guard';

@Module({
  imports: [
    ConfigModule,
    TruckLogAccessModule,
    DriverPrintDomainModule,
    TruckLogUploadModule,
    SapDocumentsModule,
  ],
  controllers: [RxoDocumentsController],
  providers: [RxoDocumentsService, RxoBrowserUploadGuard],
  exports: [RxoDocumentsService],
})
export class RxoDocumentsModule {}
