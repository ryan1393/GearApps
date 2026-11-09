import { Module } from '@nestjs/common';
import { TruckLogAccessModule } from '@truck-log/server/auth/access';
import { DriverPrintDomainModule } from '@truck-log/server/domain/driver-print';
import { DriverPrintController } from './driver-print.controller';

/** HTTP/API boundary for Driver Print Packages. */
@Module({
  imports: [DriverPrintDomainModule, TruckLogAccessModule],
  controllers: [DriverPrintController],
})
export class DriverPrintModule {}
