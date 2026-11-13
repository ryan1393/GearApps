import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EXPEDITE_DOCUMENT_SITE_KEY, expediteDirection } from './rxo-expedite-identity';

/**
 * Add the active Materials-uploaded driver-document state to Expedite rows
 * without changing row cardinality, keyed by the dedicated Expedite document
 * namespace and the exact shipment/direction.
 */
export async function withExpediteDriverDocumentState(
  dataSource: DataSource,
  config: ConfigService,
  rows: Array<Record<string, any>>,
) {
  if (!rows.length) return rows;
  const requested = rows
    .map((row) => ({
      site_key: EXPEDITE_DOCUMENT_SITE_KEY,
      shipment_id: String(row.shipmentId ?? '').trim().toUpperCase(),
      direction: expediteDirection(row),
    }))
    .filter((row) =>
      row.shipment_id
      && (row.direction === 'INBOUND' || row.direction === 'OUTBOUND'),
    );
  if (!requested.length) {
    return rows.map((row) => ({
      ...row,
      driverDocument: { status: 'NO_DOCUMENT' as const },
    }));
  }

  const documentRows = await dataSource.query(
    `WITH requested AS (
       SELECT site_key, shipment_id, direction
         FROM jsonb_to_recordset($1::jsonb)
           AS requested(site_key text, shipment_id text, direction text)
     )
     SELECT requested.site_key,
            requested.shipment_id,
            requested.direction,
            document.id AS document_id,
            document.rxo_document_version,
            document.file_name,
            document.scanned_at AS uploaded_at,
            printed.printed_at,
            latest.status AS latest_print_status
       FROM requested
       LEFT JOIN visit_documents document
         ON document.rxo_site_key = requested.site_key
        AND document.rxo_shipment_id = requested.shipment_id
        AND document.rxo_direction = requested.direction
        AND document.document_type = 'RXO_DRIVER_DOCUMENT'
        AND document.source_kind = 'MATERIALS_UPLOAD'
        AND document.rxo_is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(item.printed_at) AS printed_at
           FROM automatic_driver_print_history_v1 item
          WHERE item.visit_document_id = document.id
            AND item.item_type = 'RXO_DOCUMENT'
            AND item.status = 'PRINTED'
       ) printed ON TRUE
       LEFT JOIN LATERAL (
         SELECT item.status
           FROM automatic_driver_print_history_v1 item
          WHERE item.visit_document_id = document.id
            AND item.item_type = 'RXO_DOCUMENT'
          ORDER BY item.updated_at DESC, item.id DESC
          LIMIT 1
       ) latest ON TRUE`,
    [JSON.stringify(requested)],
  ) as Array<Record<string, unknown>>;

  const byIdentity = new Map(documentRows.map((row) => [
    `${row.site_key}\u0000${row.shipment_id}\u0000${row.direction}`,
    row,
  ]));

  const agentId = config.get<string>('TRUCK_LOG_DRIVER_PRINT_AGENT_ID', '').trim() || 'trucklog-print-pc-01';
  const route = config.get<string>('TRUCK_LOG_DRIVER_PRINT_ROUTE', '').trim() || 'RXO_DRIVER_DOCUMENT';
  const configuredOfflineSeconds = Number(
    config.get('TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS', '90'),
  );
  const offlineSeconds = Number.isInteger(configuredOfflineSeconds)
    && configuredOfflineSeconds >= 30
    && configuredOfflineSeconds <= 3600
    ? configuredOfflineSeconds
    : 90;
  const gateRows = await dataSource.query(
    `SELECT EXISTS(
       SELECT 1
         FROM print_agents agent
        WHERE agent.agent_id = $1
          AND agent.enabled = TRUE
          AND agent.last_seen_at >= NOW() - ($2::int * INTERVAL '1 second')
          AND EXISTS (
            SELECT 1
              FROM jsonb_array_elements(agent.configured_routes) configured
             WHERE configured->>'route' = $3
               AND configured->>'outputPrinter' IN (
                 SELECT value
                   FROM app_settings
                  WHERE key IN ('driver_print_east_printer', 'driver_print_west_printer')
                    AND value IS NOT NULL
                    AND BTRIM(value) <> ''
               )
          )
     ) AS online`,
    [agentId, offlineSeconds, route],
  ) as Array<{ online: boolean }>;
  const agentOnline = gateRows[0]?.online === true;

  return rows.map((row) => {
    const direction = expediteDirection(row);
    const shipmentId = String(row.shipmentId ?? '').trim().toUpperCase();
    if (!shipmentId || (direction !== 'INBOUND' && direction !== 'OUTBOUND')) {
      return {
        ...row,
        driverDocument: { status: 'NO_DOCUMENT' as const },
      };
    }
    const document = byIdentity.get(
      `${EXPEDITE_DOCUMENT_SITE_KEY}\u0000${shipmentId}\u0000${direction}`,
    );
    if (!document?.document_id) {
      return {
        ...row,
        driverDocument: { status: 'NO_DOCUMENT' as const },
      };
    }
    const latestStatus = String(document.latest_print_status ?? '');
    const status = document.printed_at
      ? 'PRINTED'
      : latestStatus === 'FAILED'
        ? 'PRINT_FAILED'
        : ['QUEUED', 'LEASED'].includes(latestStatus)
          ? 'PRINTING'
          : 'READY';
    return {
      ...row,
      driverDocument: {
        status,
        activeDocumentId: Number(document.document_id),
        version: Number(document.rxo_document_version),
        fileName: String(document.file_name ?? ''),
        uploadedAt: document.uploaded_at ?? null,
        printedAt: document.printed_at ?? null,
        agentOnline,
      },
    };
  });
}
