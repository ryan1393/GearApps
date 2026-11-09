import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TruckLogAdminModule } from '@truck-log/server/auth/admin';
import { StationAccessController, StationsAdminController } from './station-access.controller';
import { StationAccessGuard } from './station-access.guard';
import { StationAccessService } from './station-access.service';

@Module({
  imports: [TruckLogAdminModule],
  controllers: [StationAccessController, StationsAdminController],
  providers: [StationAccessService, { provide: APP_GUARD, useClass: StationAccessGuard }],
  exports: [StationAccessService],
})
export class StationAccessModule {}
