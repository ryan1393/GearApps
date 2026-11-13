import { Module } from '@nestjs/common';
import { TruckLogServerModule } from '@truck-log/server/core';

@Module({
  imports: [TruckLogServerModule],
})
export class AppModule {}
