import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintAgent, PrintAgentCredential, PrintAgentIdempotency } from '@truck-log/server/data-access';
import { PrintAgentAuthModule } from '@truck-log/server/auth/print-agent';
import { TruckLogAdminModule } from '@truck-log/server/auth/admin';
import { DriverPrintDomainModule } from '@truck-log/server/domain/driver-print';
import { SapDocumentsModule } from '@truck-log/server/infrastructure/sap-documents';
import { PrintAgentsController } from './print-agents.controller';
import { PrintAgentsService } from './print-agents.service';
import { PackingSlipIngestionService } from './packing-slip-ingestion.service';
import { PackingSlipRoutesService } from './packing-slip-routes.service';
import { PackingSlipRoutesAdminController } from './packing-slip-routes-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PrintAgent, PrintAgentCredential, PrintAgentIdempotency]),
    PrintAgentAuthModule,
    TruckLogAdminModule,
    SapDocumentsModule,
    DriverPrintDomainModule,
  ],
  controllers: [PrintAgentsController, PackingSlipRoutesAdminController],
  providers: [PrintAgentsService, PackingSlipIngestionService, PackingSlipRoutesService],
  exports: [PrintAgentsService],
})
export class PrintAgentsModule {}
