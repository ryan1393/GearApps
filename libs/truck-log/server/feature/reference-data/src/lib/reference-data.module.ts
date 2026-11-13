import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CarrierReference } from '@truck-log/server/data-access';
import { DriverReference } from '@truck-log/server/data-access';
import { LocationReference } from '@truck-log/server/data-access';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DriverReference,
      CarrierReference,
      LocationReference,
    ]),
  ],
  controllers: [ReferenceDataController],
  providers: [ReferenceDataService],
})
export class ReferenceDataModule {}
