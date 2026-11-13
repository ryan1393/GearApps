import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dock } from '@truck-log/server/data-access';
import { DocksController } from './docks.controller';
import { DocksService } from './docks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Dock])],
  controllers: [DocksController],
  providers: [DocksService],
  exports: [DocksService],
})
export class DocksModule {}
