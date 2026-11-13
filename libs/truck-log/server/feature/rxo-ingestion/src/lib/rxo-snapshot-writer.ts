import { returnedRows } from '@truck-log/server/data-access';
import { EntityManager } from 'typeorm';
import { rxoLoadAvailableSql, rxoOrderAvailableSql, scheduledLoadAvailableSql } from '@truck-log/server/domain/rxo';
import { RxoSnapshotReader, type Direction, type ParsedFreight, type ParsedOrder, type ParsedShipment, type Row } from './rxo-snapshot-reader';

/**
 * Write side of an RXO import: batched upserts of orders, shipments and
 * freight, order-shipment link refresh and scheduled-load synchronization.
 * Every method runs inside RxoIngestionService.importLatest's transaction.
 * A plain class constructed by RxoIngestionService (not a Nest provider).
 */
export class RxoSnapshotWriter {
  constructor(private readonly snapshotReader: RxoSnapshotReader) {}

  chunks<T>(items: T[], size = 500) {
    const groups: T[][] = [];
    for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
    return groups;
  }

  async upsertOrders(
    manager: EntityManager, rows: ParsedOrder[], batchId: string, siteKey: string, completeDirections: Set<Direction>,
  ) {
    for (const direction of completeDirections) {
      await manager.query(
        `UPDATE rxo_orders SET visible_in_latest=FALSE WHERE site_key=$1 AND direction=$2 AND visible_in_latest=TRUE`,
        [siteKey, direction],
      );
    }
    for (const chunk of this.chunks(rows)) {
      const payload = chunk.map((row) => ({
        site_key: siteKey, order_number: row.orderNumber, direction: row.direction, shipment_id: row.shipmentId,
        status: row.status, origin_name: row.originName, origin_address: row.originAddress,
        destination_name: row.destinationName, destination_address: row.destinationAddress,
        pickup_at: row.pickupAt?.toISOString() ?? null, delivery_at: row.deliveryAt?.toISOString() ?? null,
        customer_order_number: row.customerOrderNumber, tracking_number: row.trackingNumber,
        source_batch_id: batchId, raw_row: row.rawRow,
      }));
      await manager.query(
        `INSERT INTO rxo_orders(
           site_key,order_number,direction,shipment_id,status,origin_name,origin_address,
           destination_name,destination_address,pickup_at,delivery_at,customer_order_number,
           tracking_number,source_batch_id,visible_in_latest,last_seen_at,raw_row,created_at,updated_at)
         SELECT site_key,order_number,direction,shipment_id,status,origin_name,origin_address,
                destination_name,destination_address,pickup_at,delivery_at,customer_order_number,
                tracking_number,source_batch_id,TRUE,NOW(),raw_row,NOW(),NOW()
           FROM jsonb_to_recordset($1::jsonb) AS src(
             site_key text,order_number text,direction text,shipment_id text,status text,
             origin_name text,origin_address text,destination_name text,destination_address text,
             pickup_at timestamptz,delivery_at timestamptz,customer_order_number text,
             tracking_number text,source_batch_id text,raw_row jsonb)
         ON CONFLICT(site_key,order_number,direction) DO UPDATE SET
           shipment_id=EXCLUDED.shipment_id,status=EXCLUDED.status,origin_name=EXCLUDED.origin_name,
           origin_address=EXCLUDED.origin_address,destination_name=EXCLUDED.destination_name,
           destination_address=EXCLUDED.destination_address,pickup_at=EXCLUDED.pickup_at,
           delivery_at=EXCLUDED.delivery_at,customer_order_number=EXCLUDED.customer_order_number,
           tracking_number=EXCLUDED.tracking_number,source_batch_id=EXCLUDED.source_batch_id,
           visible_in_latest=TRUE,last_seen_at=NOW(),raw_row=EXCLUDED.raw_row,updated_at=NOW()`,
        [JSON.stringify(payload)],
      );
    }
  }

  async upsertShipments(
    manager: EntityManager, rows: ParsedShipment[], batchId: string, siteKey: string, completeDirections: Set<Direction>,
  ) {
    for (const direction of completeDirections) {
      await manager.query(
        `UPDATE rxo_shipments SET visible_in_latest=FALSE WHERE site_key=$1 AND direction=$2 AND visible_in_latest=TRUE`,
        [siteKey, direction],
      );
    }
    for (const chunk of this.chunks(rows)) {
      const payload = chunk.map((row) => ({
        site_key: siteKey, shipment_id: row.shipmentId, direction: row.direction, status: row.status,
        mode: row.mode, carrier_name: row.carrierName, order_count: row.orderCount, stop_count: row.stopCount,
        first_stop_name: row.firstStopName, first_stop_address: row.firstStopAddress,
        last_stop_name: row.lastStopName, last_stop_address: row.lastStopAddress,
        plant_scheduled_at: row.plantScheduledAt?.toISOString() ?? null, pro_number: row.proNumber,
        trailer_number: row.trailerNumber, pieces: row.pieces, total_weight: row.totalWeight,
        volume: row.volume, hazardous: row.hazardous, source_batch_id: batchId, raw_row: row.rawRow,
      }));
      await manager.query(
        `INSERT INTO rxo_shipments(
           site_key,shipment_id,direction,status,mode,carrier_name,order_count,stop_count,
           first_stop_name,first_stop_address,last_stop_name,last_stop_address,plant_scheduled_at,
           pro_number,trailer_number,pieces,total_weight,volume,hazardous,source_batch_id,
           visible_in_latest,last_seen_at,raw_row,created_at,updated_at)
         SELECT site_key,shipment_id,direction,status,mode,carrier_name,order_count,stop_count,
                first_stop_name,first_stop_address,last_stop_name,last_stop_address,plant_scheduled_at,
                pro_number,trailer_number,pieces,total_weight,volume,hazardous,source_batch_id,
                TRUE,NOW(),raw_row,NOW(),NOW()
           FROM jsonb_to_recordset($1::jsonb) AS src(
             site_key text,shipment_id text,direction text,status text,mode text,carrier_name text,
             order_count int,stop_count int,first_stop_name text,first_stop_address text,
             last_stop_name text,last_stop_address text,plant_scheduled_at timestamptz,
             pro_number text,trailer_number text,pieces text,total_weight text,volume text,
             hazardous boolean,source_batch_id text,raw_row jsonb)
         ON CONFLICT(site_key,shipment_id,direction) DO UPDATE SET
           status=EXCLUDED.status,mode=EXCLUDED.mode,carrier_name=EXCLUDED.carrier_name,
           order_count=EXCLUDED.order_count,stop_count=EXCLUDED.stop_count,
           first_stop_name=EXCLUDED.first_stop_name,first_stop_address=EXCLUDED.first_stop_address,
           last_stop_name=EXCLUDED.last_stop_name,last_stop_address=EXCLUDED.last_stop_address,
           plant_scheduled_at=COALESCE(EXCLUDED.plant_scheduled_at,rxo_shipments.plant_scheduled_at),
           pro_number=COALESCE(EXCLUDED.pro_number,rxo_shipments.pro_number),
           trailer_number=COALESCE(EXCLUDED.trailer_number,rxo_shipments.trailer_number),
           pieces=EXCLUDED.pieces,total_weight=EXCLUDED.total_weight,volume=EXCLUDED.volume,
           hazardous=EXCLUDED.hazardous,source_batch_id=EXCLUDED.source_batch_id,
           visible_in_latest=TRUE,last_seen_at=NOW(),raw_row=EXCLUDED.raw_row,updated_at=NOW()`,
        [JSON.stringify(payload)],
      );
    }
  }

  async upsertFreight(
    manager: EntityManager, rows: ParsedFreight[], batchId: string, siteKey: string, completeDirections: Set<Direction>,
  ) {
    for (const direction of completeDirections) {
      await manager.query(
        `UPDATE rxo_freight_visibility SET visible_in_latest=FALSE WHERE site_key=$1 AND direction=$2 AND visible_in_latest=TRUE`,
        [siteKey, direction],
      );
    }
    for (const chunk of this.chunks(rows)) {
      const payload = chunk.map((row) => ({
        site_key: siteKey, shipment_id: row.shipmentId, direction: row.direction, status: row.status,
        eta_status: row.etaStatus, mode: row.mode, carrier_name: row.carrierName,
        first_stop_address: row.firstStopAddress, last_stop_address: row.lastStopAddress,
        pickup_estimated_arrival_raw: row.pickupEstimatedArrivalRaw,
        pickup_appointment_arrival_raw: row.pickupAppointmentArrivalRaw,
        delivery_estimated_arrival_raw: row.deliveryEstimatedArrivalRaw,
        delivery_appointment_arrival_raw: row.deliveryAppointmentArrivalRaw,
        plant_scheduled_at: row.plantScheduledAt?.toISOString() ?? null,
        pro_number: row.proNumber, trailer_number: row.trailerNumber,
        source_batch_id: batchId, raw_row: row.rawRow,
      }));
      await manager.query(
        `INSERT INTO rxo_freight_visibility(
           site_key,shipment_id,direction,status,eta_status,mode,carrier_name,first_stop_address,last_stop_address,
           pickup_estimated_arrival_raw,pickup_appointment_arrival_raw,delivery_estimated_arrival_raw,
           delivery_appointment_arrival_raw,plant_scheduled_at,pro_number,trailer_number,source_batch_id,
           visible_in_latest,last_seen_at,raw_row,created_at,updated_at)
         SELECT site_key,shipment_id,direction,status,eta_status,mode,carrier_name,first_stop_address,last_stop_address,
                pickup_estimated_arrival_raw,pickup_appointment_arrival_raw,delivery_estimated_arrival_raw,
                delivery_appointment_arrival_raw,plant_scheduled_at,pro_number,trailer_number,source_batch_id,
                TRUE,NOW(),raw_row,NOW(),NOW()
           FROM jsonb_to_recordset($1::jsonb) AS src(
             site_key text,shipment_id text,direction text,status text,eta_status text,mode text,carrier_name text,
             first_stop_address text,last_stop_address text,pickup_estimated_arrival_raw text,
             pickup_appointment_arrival_raw text,delivery_estimated_arrival_raw text,
             delivery_appointment_arrival_raw text,plant_scheduled_at timestamptz,pro_number text,
             trailer_number text,source_batch_id text,raw_row jsonb)
         ON CONFLICT(site_key,shipment_id,direction) DO UPDATE SET
           status=EXCLUDED.status,eta_status=EXCLUDED.eta_status,mode=EXCLUDED.mode,
           carrier_name=EXCLUDED.carrier_name,first_stop_address=EXCLUDED.first_stop_address,
           last_stop_address=EXCLUDED.last_stop_address,
           pickup_estimated_arrival_raw=EXCLUDED.pickup_estimated_arrival_raw,
           pickup_appointment_arrival_raw=EXCLUDED.pickup_appointment_arrival_raw,
           delivery_estimated_arrival_raw=EXCLUDED.delivery_estimated_arrival_raw,
           delivery_appointment_arrival_raw=EXCLUDED.delivery_appointment_arrival_raw,
           plant_scheduled_at=COALESCE(EXCLUDED.plant_scheduled_at,rxo_freight_visibility.plant_scheduled_at),
           pro_number=COALESCE(EXCLUDED.pro_number,rxo_freight_visibility.pro_number),
           trailer_number=COALESCE(EXCLUDED.trailer_number,rxo_freight_visibility.trailer_number),
           source_batch_id=EXCLUDED.source_batch_id,visible_in_latest=TRUE,last_seen_at=NOW(),
           raw_row=EXCLUDED.raw_row,updated_at=NOW()`,
        [JSON.stringify(payload)],
      );
    }
  }

  async syncLinks(
    manager: EntityManager, orders: ParsedOrder[], shipments: ParsedShipment[], batchId: string, siteKey: string,
    refreshDirections: Set<Direction>,
    cancelledOrderKeys: ReadonlySet<string> = new Set<string>(),
  ) {
    for (const direction of refreshDirections) {
      await manager.query(
        `UPDATE rxo_order_shipment_links
            SET visible_in_latest=FALSE
          WHERE site_key=$1 AND direction=$2 AND visible_in_latest=TRUE`,
        [siteKey, direction],
      );
    }

    const linkMap = new Map<string, { site_key: string; order_number: string; shipment_id: string; direction: Direction; source_batch_id: string }>();
    for (const order of orders) {
      if (!order.shipmentId) continue;
      const key = `${order.orderNumber}|${order.shipmentId}|${order.direction}`;
      linkMap.set(key, { site_key: siteKey, order_number: order.orderNumber, shipment_id: order.shipmentId, direction: order.direction, source_batch_id: batchId });
    }
    for (const shipment of shipments) {
      for (const orderNumber of shipment.orderNumbers) {
        const key = `${orderNumber}|${shipment.shipmentId}|${shipment.direction}`;
        linkMap.set(key, { site_key: siteKey, order_number: orderNumber, shipment_id: shipment.shipmentId, direction: shipment.direction, source_batch_id: batchId });
      }
    }

    const links = [...linkMap.values()].filter((link) => refreshDirections.has(link.direction)
      && !cancelledOrderKeys.has(`${link.direction}|${link.order_number}`));
    for (const chunk of this.chunks(links)) {
      await manager.query(
        `INSERT INTO rxo_order_shipment_links(
           site_key,order_number,shipment_id,direction,source_batch_id,visible_in_latest,last_seen_at,created_at,updated_at)
         SELECT site_key,order_number,shipment_id,direction,source_batch_id,TRUE,NOW(),NOW(),NOW()
           FROM jsonb_to_recordset($1::jsonb) AS src(
             site_key text,order_number text,shipment_id text,direction text,source_batch_id text)
         ON CONFLICT(site_key,order_number,shipment_id,direction) DO UPDATE SET
           source_batch_id=EXCLUDED.source_batch_id,visible_in_latest=TRUE,last_seen_at=NOW(),updated_at=NOW()`,
        [JSON.stringify(chunk)],
      );
    }
    return links.length;
  }

  async syncScheduledLoads(
    manager: EntityManager,
    orders: ParsedOrder[], shipments: ParsedShipment[], freight: ParsedFreight[], batchId: string, siteKey: string,
  ) {
    const directionSets = new Map<string, Set<Direction>>();
    const state = new Map<string, { shipmentId: string; direction: Direction; at: Date | null; status: string | null }>();

    const merge = (shipmentId: string, direction: Direction, at: Date | null, status: string | null, prefer = false) => {
      if (!directionSets.has(shipmentId)) directionSets.set(shipmentId, new Set<Direction>());
      directionSets.get(shipmentId)!.add(direction);
      const key = `${shipmentId}|${direction}`;
      const previous = state.get(key);
      state.set(key, {
        shipmentId, direction,
        at: prefer ? (at ?? previous?.at ?? null) : (previous?.at ?? at ?? null),
        status: prefer ? (status ?? previous?.status ?? null) : (previous?.status ?? status ?? null),
      });
    };

    // Schedule precedence: FOM > Shipments > linked Orders fallback.
    for (const row of shipments) merge(row.shipmentId, row.direction, row.plantScheduledAt, row.status);
    for (const row of freight) merge(row.shipmentId, row.direction, row.plantScheduledAt, row.status, true);
    for (const row of orders) {
      if (!row.shipmentId) continue;
      const at = row.direction === 'OUTBOUND' ? row.pickupAt : row.deliveryAt;
      merge(row.shipmentId, row.direction, at, row.status);
    }

    const candidates: Array<{ load_number: string; scheduled_at: string; source: string }> = [];
    const terminal: Array<{ load_number: string }> = [];
    const sourcePrefix = `RXO:${siteKey}:`;
    const source = `${sourcePrefix}${batchId}`.slice(0, 120);

    for (const row of state.values()) {
      // A shipment seen as both inbound and outbound at one Truck Log site is
      // ambiguous. Never collapse it to one scheduled_load row automatically.
      if ((directionSets.get(row.shipmentId)?.size ?? 0) !== 1) continue;
      if (this.snapshotReader.isTerminalStatus(row.status)) {
        terminal.push({ load_number: row.shipmentId });
        continue;
      }
      if (row.at) candidates.push({ load_number: row.shipmentId, scheduled_at: row.at.toISOString(), source });
    }

    let deactivatedScheduledLoadRows = 0;
    for (const chunk of this.chunks(terminal)) {
      const result = returnedRows(await manager.query(
        `UPDATE scheduled_loads scheduled
            SET active=FALSE,updated_at=NOW()
           FROM jsonb_to_recordset($1::jsonb) AS src(load_number text)
          WHERE scheduled.active=TRUE
            AND scheduled.source LIKE $2
            AND UPPER(scheduled.load_number)=UPPER(src.load_number)
        RETURNING scheduled.id`,
        [JSON.stringify(chunk), `${sourcePrefix}%`],
      ));
      deactivatedScheduledLoadRows += result.length;
    }

    // Absence from the latest RXO export does NOT deactivate Truck Log schedules;
    // export windows can move. Only an explicit terminal RXO status deactivates.
    for (const chunk of this.chunks(candidates)) {
      await manager.query(
        `UPDATE scheduled_loads scheduled
            SET scheduled_at=src.scheduled_at,source=src.source,active=TRUE,updated_at=NOW()
           FROM jsonb_to_recordset($1::jsonb) AS src(load_number text,scheduled_at timestamptz,source text)
          WHERE scheduled.active=TRUE AND UPPER(scheduled.load_number)=UPPER(src.load_number)`,
        [JSON.stringify(chunk)],
      );
      await manager.query(
        `INSERT INTO scheduled_loads(load_number,scheduled_at,active,source,created_at,updated_at)
         SELECT src.load_number,src.scheduled_at,TRUE,src.source,NOW(),NOW()
           FROM jsonb_to_recordset($1::jsonb) AS src(load_number text,scheduled_at timestamptz,source text)
          WHERE NOT EXISTS (
            SELECT 1 FROM scheduled_loads existing
             WHERE existing.active=TRUE AND UPPER(existing.load_number)=UPPER(src.load_number)
          )`,
        [JSON.stringify(chunk)],
      );
    }

    return { scheduledLoadRows: candidates.length, deactivatedScheduledLoadRows };
  }
}
