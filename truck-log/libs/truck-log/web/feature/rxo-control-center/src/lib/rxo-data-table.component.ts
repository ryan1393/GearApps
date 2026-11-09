import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { RxoFreightRecord, RxoOrderRecord, RxoShipmentRecord } from '@truck-log/shared/contracts';
import * as rxoPresenter from './rxo-control-center.presenter';
import { RxoDataStore, type RxoRow } from './rxo-data.store';

/**
 * RXO Data tab body: dataset tabs, filters, the Shipments / Orders / Freight
 * tables with row details and driver-document upload, and paging.
 * Hosted on the Control Center's tab-panel <section>; state lives in RxoDataStore.
 */
@Component({
  selector: 'section[tlRxoDataTable]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rxo-data-table.component.html',
})
export class RxoDataTableComponent {
  readonly data = inject(RxoDataStore);

  readonly rxoDirectionalRouteLabel = rxoPresenter.rxoDirectionalRouteLabel;
  readonly rxoDirectionalRouteValue = rxoPresenter.rxoDirectionalRouteValue;
  readonly statusTone = rxoPresenter.danaStatusTone;
  readonly statusSummaryDetail = rxoPresenter.statusSummaryDetail;
  readonly rxoSiteTimeLabel = rxoPresenter.rxoSiteTimeLabel;
  readonly rxoSiteTime = rxoPresenter.rxoSiteTime;

  directionTone(direction?: string | null) {
    return String(direction ?? '').toUpperCase() === 'INBOUND' ? 'info' : 'neutral';
  }

  asOrder(row: RxoRow) { return row as RxoOrderRecord; }
  asShipment(row: RxoRow) { return row as RxoShipmentRecord; }
  asFreight(row: RxoRow) { return row as RxoFreightRecord; }
}
