import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledLoad } from '@truck-log/server/data-access';
import { TruckLogUploadModule } from '@truck-log/server/infrastructure/uploads';
import { ScheduledLoadsController } from './scheduled-loads.controller';
import { ScheduledLoadsService } from './scheduled-loads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduledLoad]),
    TruckLogUploadModule,
  ],
  controllers: [ScheduledLoadsController],
  providers: [ScheduledLoadsService],
  exports: [ScheduledLoadsService],
})
export class ScheduledLoadsModule {}
