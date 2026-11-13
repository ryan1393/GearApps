import { TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CreateCarrierReferenceDto,
  CreateDriverReferenceDto,
  CreateLocationReferenceDto,
  UpdateCarrierReferenceDto,
  UpdateDriverReferenceDto,
  UpdateLocationReferenceDto,
} from './dto/reference-data.dto';
import { ReferenceDataService } from './reference-data.service';

@TruckLogAdminWrites()
@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly service: ReferenceDataService) {}

  private includeInactive(value?: string) {
    return String(value || '').toLowerCase() === 'true';
  }

  @Get('check-in')
  checkIn() {
    return this.service.checkInReferenceData();
  }

  @Get('drivers')
  drivers(@Query('includeInactive') includeInactive?: string) {
    return this.service.drivers(this.includeInactive(includeInactive));
  }

  @Post('drivers')
  createDriver(@Body() dto: CreateDriverReferenceDto) {
    return this.service.createDriver(dto);
  }

  @Patch('drivers/:id')
  updateDriver(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDriverReferenceDto) {
    return this.service.updateDriver(id, dto);
  }

  @Get('carriers')
  carriers(@Query('includeInactive') includeInactive?: string) {
    return this.service.carriers(this.includeInactive(includeInactive));
  }

  @Post('carriers')
  createCarrier(@Body() dto: CreateCarrierReferenceDto) {
    return this.service.createCarrier(dto);
  }

  @Patch('carriers/:id')
  updateCarrier(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCarrierReferenceDto) {
    return this.service.updateCarrier(id, dto);
  }

  @Get('locations')
  locations(@Query('includeInactive') includeInactive?: string) {
    return this.service.locations(this.includeInactive(includeInactive));
  }

  @Post('locations')
  createLocation(@Body() dto: CreateLocationReferenceDto) {
    return this.service.createLocation(dto);
  }

  @Patch('locations/:id')
  updateLocation(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLocationReferenceDto) {
    return this.service.updateLocation(id, dto);
  }
}
