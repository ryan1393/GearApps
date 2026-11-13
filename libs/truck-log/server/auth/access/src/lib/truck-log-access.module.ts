import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TruckLogAccessCredential } from '@truck-log/server/data-access';
import { TruckLogAccessIdempotency } from '@truck-log/server/data-access';
import { TruckLogAccessGuard } from './truck-log-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TruckLogAccessCredential,
      TruckLogAccessIdempotency,
    ]),
  ],
  providers: [TruckLogAccessGuard],
  exports: [TruckLogAccessGuard, TypeOrmModule],
})
export class TruckLogAccessModule {}
