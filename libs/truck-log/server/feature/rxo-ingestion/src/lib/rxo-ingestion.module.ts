import { RxoConnectionRecoveryModule } from '@truck-log/server/infrastructure/rxo-recovery';
import { RxoControlService } from './rxo-control.service';
import { RxoControlController } from './rxo-control.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RxoFreightVisibility } from '@truck-log/server/data-access';
import { RxoImportBatch } from '@truck-log/server/data-access';
import { RxoOrder } from '@truck-log/server/data-access';
import { RxoOrderShipmentLink } from '@truck-log/server/data-access';
import { RxoShipment } from '@truck-log/server/data-access';
import { RxoIngestionController } from './rxo-ingestion.controller';
import { RxoIngestionService } from './rxo-ingestion.service';
import { TruckLogAdminModule } from '@truck-log/server/auth/admin';

@Module({
  imports: [
    TruckLogAdminModule,
    RxoConnectionRecoveryModule,
    TypeOrmModule.forFeature([
      RxoImportBatch,
      RxoOrder,
      RxoShipment,
      RxoFreightVisibility,
      RxoOrderShipmentLink,
    ]),
  ],
  controllers: [RxoIngestionController, RxoControlController],
  providers: [RxoIngestionService, RxoControlService],
  exports: [RxoIngestionService],
})
export class RxoIngestionModule {}
