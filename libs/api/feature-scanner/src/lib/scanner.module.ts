import { GearModule } from '@gearapps/api/feature-gear';
import { Module } from '@nestjs/common';
import { ScannerClientService } from './scanner-client.service';
import { ScannerController } from './scanner.controller';

@Module({
  imports: [GearModule],
  controllers: [ScannerController],
  providers: [ScannerClientService],
  exports: [ScannerClientService],
})
export class ScannerModule {}
