import { ServerDataAccessModule } from '@gearapps/manufacturing/server/data-access';
import { Module } from '@nestjs/common';

import { LabelPrinterController } from './label-printers/label-printer.controller';
import { LabelPrinterService } from './label-printers/label-printer.service';
import { ServerFeatAssetTagController } from './server-feat-asset-tag.controller';
import { ServerFeatAssetTagService } from './server-feat-asset-tag.service';
import { ServerFeatTrayController } from './server-feat-tray.controller';
import { ServerFeatTrayService } from './server-feat-tray.service';

@Module({
  imports: [ServerDataAccessModule],
  controllers: [ServerFeatTrayController, ServerFeatAssetTagController, LabelPrinterController],
  providers: [ServerFeatTrayService, ServerFeatAssetTagService, LabelPrinterService],
  exports: [ServerFeatTrayService, LabelPrinterService],
})
export class ServerFeatTrayModule {}
