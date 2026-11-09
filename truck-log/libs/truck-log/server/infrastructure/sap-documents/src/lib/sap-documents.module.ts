import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SapDocumentEvent } from '@truck-log/server/data-access';
import { SapDocumentType } from '@truck-log/server/data-access';
import { VisitDocument } from '@truck-log/server/data-access';
import { SapDocumentStorageService } from './sap-document-storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SapDocumentType,
      SapDocumentEvent,
      VisitDocument,
    ]),
  ],
  providers: [SapDocumentStorageService],
  exports: [SapDocumentStorageService],
})
export class SapDocumentsModule {}
