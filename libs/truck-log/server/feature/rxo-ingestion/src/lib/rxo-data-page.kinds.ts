import { rxoLoadAvailableSql, rxoOrderAvailableSql } from '@truck-log/server/domain/rxo';
import { activeRxoPlantWindowClause, activeRxoStatusClause } from './rxo-data-page.clauses';
import type { RxoDataPageQueryContext } from './rxo-data-page.query';

type Row = Record<string, unknown>;

// Bodies keep their original indentation so the SQL text is byte-identical.

/** Normalized request state shared by the per-kind RXO data page queries. */
export interface RxoDataPageScope {
  ctx: RxoDataPageQueryContext;
  clauses: string[];
  params: unknown[];
  bind: (value: unknown) => string;
  plantTimeZoneToken: string;
  siteKey: string | null;
  normalizedDirection: string | undefined;
  search: string | null;
  offset: number;
  safePage: number;
  safePageSize: number;
}

export async function listRxoOrdersPage(scope: RxoDataPageScope) {
      const { ctx, clauses, params, bind, plantTimeZoneToken, siteKey, normalizedDirection, search, offset, safePage, safePageSize } = scope;
      clauses.push('visible_in_latest=TRUE');
      clauses.push(rxoOrderAvailableSql('rxo_orders'));
      clauses.push(activeRxoStatusClause('status'));
      clauses.push(activeRxoPlantWindowClause(
        `CASE WHEN direction='OUTBOUND' THEN pickup_at ELSE delivery_at END`,
        plantTimeZoneToken,
      ));

      if (siteKey) {
        clauses.push(`site_key=${bind(siteKey)}`);
      }

      if (normalizedDirection) {
        clauses.push(
          `direction=${bind(normalizedDirection)}`,
        );
      }

      if (search) {
        const token = bind(search);

        clauses.push(`(
          order_number ILIKE ${token}
          OR COALESCE(shipment_id,'') ILIKE ${token}
          OR COALESCE(status,'') ILIKE ${token}
          OR COALESCE(origin_name,'') ILIKE ${token}
          OR COALESCE(origin_address,'') ILIKE ${token}
          OR COALESCE(destination_name,'') ILIKE ${token}
          OR COALESCE(destination_address,'') ILIKE ${token}
          OR COALESCE(customer_order_number,'') ILIKE ${token}
          OR COALESCE(tracking_number,'') ILIKE ${token}
        )`);
      }

      const where = clauses.length
        ? `WHERE ${clauses.join(' AND ')}`
        : '';

      const [countRows, statusRows, rows] = await Promise.all([
        ctx.dataSource.query(
          `SELECT COUNT(*)::int AS total
             FROM rxo_orders
             ${where}`,
          params,
        ),
        ctx.dataSource.query(
          `SELECT COALESCE(NULLIF(BTRIM(status),''),'Unspecified') AS status,
                  COUNT(*)::int AS count
             FROM rxo_orders
             ${where}
            GROUP BY 1
            ORDER BY count DESC, status
            LIMIT 6`,
          params,
        ),
        ctx.dataSource.query(
          `SELECT
              site_key,
              order_number,
              direction,
              shipment_id,
              status,
              origin_name,
              origin_address,
              destination_name,
              destination_address,
              pickup_at,
              delivery_at,
              customer_order_number,
              tracking_number,
              source_batch_id,
              visible_in_latest,
              last_seen_at,
              raw_row
             FROM rxo_orders
             ${where}
            ORDER BY
              COALESCE(pickup_at,delivery_at) NULLS LAST,
              order_number
            LIMIT $${params.length + 1}
           OFFSET $${params.length + 2}`,
          [...params, safePageSize, offset],
        ),
      ]);

      const orderRows = rows.map((row: Record<string, unknown>) => {
        const raw = row.raw_row && typeof row.raw_row === 'object' && !Array.isArray(row.raw_row)
          ? row.raw_row as Row
          : {};
        const pickupAt = typeof row.pickup_at === 'string'
          ? row.pickup_at
          : ctx.orderStopDate(raw, 'pickup')?.toISOString() ?? null;
        const deliveryAt = typeof row.delivery_at === 'string'
          ? row.delivery_at
          : ctx.orderStopDate(raw, 'delivery')?.toISOString() ?? null;
        const { raw_row: _rawRow, ...publicRow } = row;
        return { ...publicRow, pickup_at: pickupAt, delivery_at: deliveryAt };
      });

      return {
        kind: 'orders' as const,
        page: safePage,
        pageSize: safePageSize,
        total: Number(countRows[0]?.total ?? 0),
        statusSummary: statusRows.map((row: Record<string, unknown>) => ({
          status: String(row.status ?? 'Unspecified'),
          count: Number(row.count ?? 0),
        })),
        rows: orderRows,
      };
}

export async function listRxoShipmentsPage(scope: RxoDataPageScope) {
      const { ctx, clauses, params, bind, plantTimeZoneToken, siteKey, normalizedDirection, search, offset, safePage, safePageSize } = scope;
      clauses.push('(shipment_visible_in_latest=TRUE OR freight_visible_in_latest=TRUE)');
      clauses.push(rxoLoadAvailableSql('rxo_shipment_context.site_key', 'rxo_shipment_context.shipment_id', 'rxo_shipment_context.direction'));
      clauses.push(activeRxoStatusClause('COALESCE(current_status,shipment_status)'));
      clauses.push(activeRxoPlantWindowClause('plant_scheduled_at', plantTimeZoneToken));

      if (siteKey) {
        clauses.push(`site_key=${bind(siteKey)}`);
      }

      if (normalizedDirection) {
        clauses.push(
          `direction=${bind(normalizedDirection)}`,
        );
      }

      if (search) {
        const token = bind(search);

        clauses.push(`(
          shipment_id ILIKE ${token}
          OR COALESCE(shipment_status,'') ILIKE ${token}
          OR COALESCE(current_status,'') ILIKE ${token}
          OR COALESCE(eta_status,'') ILIKE ${token}
          OR COALESCE(mode,'') ILIKE ${token}
          OR COALESCE(carrier_name,'') ILIKE ${token}
          OR COALESCE(pro_number,'') ILIKE ${token}
          OR COALESCE(trailer_number,'') ILIKE ${token}
          OR COALESCE(first_stop_name,'') ILIKE ${token}
          OR COALESCE(first_stop_address,'') ILIKE ${token}
          OR COALESCE(last_stop_name,'') ILIKE ${token}
          OR COALESCE(last_stop_address,'') ILIKE ${token}
          OR COALESCE(pickup_estimated_arrival_raw,'') ILIKE ${token}
          OR COALESCE(pickup_appointment_arrival_raw,'') ILIKE ${token}
          OR COALESCE(delivery_estimated_arrival_raw,'') ILIKE ${token}
          OR COALESCE(delivery_appointment_arrival_raw,'') ILIKE ${token}
          OR array_to_string(order_numbers, ',') ILIKE ${token}
          OR EXISTS (
            SELECT 1
              FROM rxo_orders linked_search
             WHERE linked_search.site_key = rxo_shipment_context.site_key
               AND linked_search.shipment_id = rxo_shipment_context.shipment_id
               AND linked_search.direction = rxo_shipment_context.direction
               AND linked_search.visible_in_latest = TRUE
               AND (
                 COALESCE(linked_search.origin_name,'') ILIKE ${token}
                 OR COALESCE(linked_search.origin_address,'') ILIKE ${token}
                 OR COALESCE(linked_search.destination_name,'') ILIKE ${token}
                 OR COALESCE(linked_search.destination_address,'') ILIKE ${token}
               )
          )
        )`);
      }

      const where = clauses.length
        ? `WHERE ${clauses.join(' AND ')}`
        : '';

      const [countRows, statusRows, rows] = await Promise.all([
        ctx.dataSource.query(
          `SELECT COUNT(*)::int AS total
             FROM rxo_shipment_context
             ${where}`,
          params,
        ),
        ctx.dataSource.query(
          `SELECT COALESCE(NULLIF(BTRIM(COALESCE(current_status,shipment_status)),''),'Unspecified') AS status,
                  COUNT(*)::int AS count
             FROM rxo_shipment_context
             ${where}
            GROUP BY 1
            ORDER BY count DESC, status
            LIMIT 6`,
          params,
        ),
        ctx.dataSource.query(
          `SELECT
              site_key,
              shipment_id,
              direction,
              shipment_status,
              current_status,
              eta_status,
              mode,
              carrier_name,
              plant_scheduled_at,
              pickup_estimated_arrival_raw,
              pickup_appointment_arrival_raw,
              delivery_estimated_arrival_raw,
              delivery_appointment_arrival_raw,
              CASE
                WHEN direction='OUTBOUND' THEN endpoints.pickup_site_time
                WHEN direction='INBOUND' THEN endpoints.delivery_site_time
                ELSE COALESCE(endpoints.pickup_site_time,endpoints.delivery_site_time)
              END AS orders_site_time,
              pro_number,
              trailer_number,
              first_stop_name,
              first_stop_address,
              last_stop_name,
              last_stop_address,
              COALESCE(
                endpoints.origin_name,
                NULLIF(BTRIM(first_stop_name),'')
              ) AS origin_name,
              COALESCE(
                endpoints.origin_address,
                NULLIF(BTRIM(first_stop_address),'')
              ) AS origin_address,
              COALESCE(
                endpoints.destination_name,
                NULLIF(BTRIM(last_stop_name),'')
              ) AS destination_name,
              COALESCE(
                endpoints.destination_address,
                NULLIF(BTRIM(last_stop_address),'')
              ) AS destination_address,
              order_numbers,
              linked_order_count,
              shipment_visible_in_latest,
              freight_visible_in_latest,
              shipment_source_batch_id,
              visibility_source_batch_id
             FROM rxo_shipment_context
             LEFT JOIN LATERAL (
               SELECT
                 MIN(linked_order.pickup_at) AS pickup_site_time,
                 MIN(linked_order.delivery_at) AS delivery_site_time,
                 NULLIF(
                   STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.origin_name),''), ' / '),
                   ''
                 ) AS origin_name,
                 NULLIF(
                   STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.origin_address),''), ' / '),
                   ''
                 ) AS origin_address,
                 NULLIF(
                   STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.destination_name),''), ' / '),
                   ''
                 ) AS destination_name,
                 NULLIF(
                   STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.destination_address),''), ' / '),
                   ''
                 ) AS destination_address
                 FROM rxo_order_shipment_links linked_link
                 JOIN rxo_orders linked_order
                   ON linked_order.site_key = linked_link.site_key
                  AND linked_order.order_number = linked_link.order_number
                  AND linked_order.direction = linked_link.direction
                WHERE linked_link.site_key = rxo_shipment_context.site_key
                  AND linked_link.shipment_id = rxo_shipment_context.shipment_id
                  AND linked_link.direction = rxo_shipment_context.direction
                  AND linked_link.visible_in_latest = TRUE
             ) endpoints ON TRUE
             ${where}
            ORDER BY
              COALESCE(
                CASE
                  WHEN BTRIM(COALESCE(pickup_appointment_arrival_raw,'')) ~*
                    '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[[:space:]]+[0-9]{1,2},[[:space:]]*[0-9]{4}[[:space:]]+[0-9]{1,2}:[0-9]{2}$'
                    THEN to_timestamp(BTRIM(pickup_appointment_arrival_raw), 'Mon DD, YYYY HH24:MI')
                  ELSE NULL
                END,
                CASE
                  WHEN BTRIM(COALESCE(pickup_estimated_arrival_raw,'')) ~*
                    '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[[:space:]]+[0-9]{1,2},[[:space:]]*[0-9]{4}[[:space:]]+[0-9]{1,2}:[0-9]{2}$'
                    THEN to_timestamp(BTRIM(pickup_estimated_arrival_raw), 'Mon DD, YYYY HH24:MI')
                  ELSE NULL
                END,
                CASE WHEN direction='OUTBOUND' THEN plant_scheduled_at ELSE NULL END
              ) ASC NULLS LAST,
              shipment_id,
              direction
            LIMIT $${params.length + 1}
           OFFSET $${params.length + 2}`,
          [...params, safePageSize, offset],
        ),
      ]);

      return {
        kind: 'shipments' as const,
        page: safePage,
        pageSize: safePageSize,
        total: Number(countRows[0]?.total ?? 0),
        statusSummary: statusRows.map((row: Record<string, unknown>) => ({
          status: String(row.status ?? 'Unspecified'),
          count: Number(row.count ?? 0),
        })),
        rows: await ctx.withDriverDocumentState(rows),
      };
}

export async function listRxoFreightPage(scope: RxoDataPageScope) {
    const { ctx, clauses, params, bind, plantTimeZoneToken, siteKey, normalizedDirection, search, offset, safePage, safePageSize } = scope;
    clauses.push('visible_in_latest=TRUE');
    clauses.push(rxoLoadAvailableSql('rxo_freight_visibility.site_key', 'rxo_freight_visibility.shipment_id', 'rxo_freight_visibility.direction'));
    clauses.push(activeRxoStatusClause('status'));
    clauses.push(activeRxoPlantWindowClause('plant_scheduled_at', plantTimeZoneToken));

    if (siteKey) {
      clauses.push(`site_key=${bind(siteKey)}`);
    }

    if (normalizedDirection) {
      clauses.push(
        `direction=${bind(normalizedDirection)}`,
      );
    }

    if (search) {
      const token = bind(search);

      clauses.push(`(
        shipment_id ILIKE ${token}
        OR COALESCE(status,'') ILIKE ${token}
        OR COALESCE(eta_status,'') ILIKE ${token}
        OR COALESCE(mode,'') ILIKE ${token}
        OR COALESCE(carrier_name,'') ILIKE ${token}
        OR COALESCE(pro_number,'') ILIKE ${token}
        OR COALESCE(trailer_number,'') ILIKE ${token}
        OR COALESCE(first_stop_address,'') ILIKE ${token}
        OR COALESCE(last_stop_address,'') ILIKE ${token}
      )`);
    }

    const where = clauses.length
      ? `WHERE ${clauses.join(' AND ')}`
      : '';

    const [countRows, statusRows, rows] = await Promise.all([
      ctx.dataSource.query(
        `SELECT COUNT(*)::int AS total
           FROM rxo_freight_visibility
           ${where}`,
        params,
      ),
      ctx.dataSource.query(
        `SELECT COALESCE(NULLIF(BTRIM(status),''),'Unspecified') AS status,
                COUNT(*)::int AS count
           FROM rxo_freight_visibility
           ${where}
          GROUP BY 1
          ORDER BY count DESC, status
          LIMIT 6`,
        params,
      ),
      ctx.dataSource.query(
        `SELECT
            site_key,
            shipment_id,
            direction,
            status,
            eta_status,
            mode,
            carrier_name,
            plant_scheduled_at,
            pro_number,
            trailer_number,
            (
              SELECT NULLIF(BTRIM(short_route_names.first_stop_name),'')
                FROM rxo_shipment_context short_route_names
               WHERE short_route_names.site_key = rxo_freight_visibility.site_key
                 AND short_route_names.shipment_id = rxo_freight_visibility.shipment_id
                 AND short_route_names.direction = rxo_freight_visibility.direction
               LIMIT 1
            ) AS first_stop_name,
            first_stop_address,
            (
              SELECT NULLIF(BTRIM(short_route_names.last_stop_name),'')
                FROM rxo_shipment_context short_route_names
               WHERE short_route_names.site_key = rxo_freight_visibility.site_key
                 AND short_route_names.shipment_id = rxo_freight_visibility.shipment_id
                 AND short_route_names.direction = rxo_freight_visibility.direction
               LIMIT 1
            ) AS last_stop_name,
            last_stop_address,
            (
              SELECT NULLIF(
                STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.origin_name),''), ' / '),
                ''
              )
                FROM rxo_order_shipment_links linked_link
                JOIN rxo_orders linked_order
                  ON linked_order.site_key = linked_link.site_key
                 AND linked_order.order_number = linked_link.order_number
                 AND linked_order.direction = linked_link.direction
               WHERE linked_link.site_key = rxo_freight_visibility.site_key
                 AND linked_link.shipment_id = rxo_freight_visibility.shipment_id
                 AND linked_link.direction = rxo_freight_visibility.direction
                 AND linked_link.visible_in_latest = TRUE
            ) AS origin_name,
            (
              SELECT NULLIF(
                STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.destination_name),''), ' / '),
                ''
              )
                FROM rxo_order_shipment_links linked_link
                JOIN rxo_orders linked_order
                  ON linked_order.site_key = linked_link.site_key
                 AND linked_order.order_number = linked_link.order_number
                 AND linked_order.direction = linked_link.direction
               WHERE linked_link.site_key = rxo_freight_visibility.site_key
                 AND linked_link.shipment_id = rxo_freight_visibility.shipment_id
                 AND linked_link.direction = rxo_freight_visibility.direction
                 AND linked_link.visible_in_latest = TRUE
            ) AS destination_name,
            pickup_estimated_arrival_raw,
            pickup_appointment_arrival_raw,
            delivery_estimated_arrival_raw,
            delivery_appointment_arrival_raw,
            source_batch_id,
            visible_in_latest,
            last_seen_at
           FROM rxo_freight_visibility
           ${where}
          ORDER BY
            plant_scheduled_at NULLS LAST,
            shipment_id
          LIMIT $${params.length + 1}
         OFFSET $${params.length + 2}`,
        [...params, safePageSize, offset],
      ),
    ]);

    return {
      kind: 'freight' as const,
      page: safePage,
      pageSize: safePageSize,
      total: Number(countRows[0]?.total ?? 0),
      statusSummary: statusRows.map((row: Record<string, unknown>) => ({
        status: String(row.status ?? 'Unspecified'),
        count: Number(row.count ?? 0),
      })),
      rows: await ctx.withDriverDocumentState(rows),
    };
}
