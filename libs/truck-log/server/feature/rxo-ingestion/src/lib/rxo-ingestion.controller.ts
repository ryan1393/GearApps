import { TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RxoIngestionService } from './rxo-ingestion.service';

@TruckLogAdminWrites()
@Controller('rxo')
export class RxoIngestionController {
  constructor(private readonly rxo: RxoIngestionService) {}

  @Get('status')
  status() { return this.rxo.status(); }

  @Post('import-latest')
  importLatest() { return this.rxo.importLatest(); }

  @Get('orders-diagnostics')
  ordersDiagnostics(@Query('site') site?: string) { return this.rxo.ordersDiagnostics(site); }

  @Get('data')
  data(
    @Query('kind') kind?: string,
    @Query('site') site?: string,
    @Query('direction') direction?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.rxo.listDataPage(
      kind,
      site,
      direction,
      q,
      Number(page ?? 1),
      Number(pageSize ?? 100),
    );
  }

  @Get('shipments')
  shipments(
    @Query('site') site?: string,
    @Query('direction') direction?: string,
    @Query('limit') limit?: string,
  ) {
    return this.rxo.listShipments(site, direction, Number(limit ?? 200));
  }

  @Get('orders')
  orders(
    @Query('site') site?: string,
    @Query('shipmentId') shipmentId?: string,
    @Query('direction') direction?: string,
    @Query('limit') limit?: string,
  ) {
    return this.rxo.listOrders(site, shipmentId, direction, Number(limit ?? 500));
  }

  @Get('shipments/:shipmentId')
  shipment(
    @Param('shipmentId') shipmentId: string,
    @Query('site') site?: string,
  ) {
    return this.rxo.lookupShipment(shipmentId, site);
  }
}
