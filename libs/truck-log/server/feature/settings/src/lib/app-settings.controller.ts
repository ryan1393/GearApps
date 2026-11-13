import { TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { UpdateDockAgingSettingsDto } from './dto/update-dock-aging-settings.dto';
import { UpdateGatePrintingSettingsDto } from './dto/update-gate-printing-settings.dto';

@TruckLogAdminWrites()
@Controller('settings')
export class AppSettingsController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get('dock-aging')
  dockAging() {
    return this.settings.getDockAging();
  }

  @Patch('dock-aging')
  updateDockAging(@Body() dto: UpdateDockAgingSettingsDto) {
    return this.settings.updateDockAging(dto);
  }

  @Get('gate-printing')
  gatePrinting() {
    return this.settings.getGatePrinting();
  }

  @Patch('gate-printing')
  updateGatePrinting(@Body() dto: UpdateGatePrintingSettingsDto) {
    return this.settings.updateGatePrinting(dto);
  }
}
