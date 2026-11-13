import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rxoImportHealth } from './rxo-import-health';
import { rxoLoadAvailableSql, rxoOrderAvailableSql, scheduledLoadAvailableSql } from '@truck-log/server/domain/rxo';
import { activeRxoStatusClause, listRxoDataPage, normalizeRxoSite } from './rxo-data-page.query';
import { RxoSnapshotReader, type Boundary, type Direction, type ParsedFreight, type ParsedOrder, type ParsedShipment, type Row } from './rxo-snapshot-reader';
import { rxoBoundaryPath, rxoLatestRoot, rxoPlantTimeZone } from './rxo-ingestion-paths';

/**
 * Read endpoints of RXO ingestion: import status, the on-demand order trace,
 * paged RXO data, shipment/order lists and single-shipment lookup. Never
 * imports or writes. A plain class constructed by RxoIngestionService.
 */
export class RxoIngestionQueries {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly snapshotReader: RxoSnapshotReader,
  ) {}

  /**
   * Add the active Materials-uploaded driver-document state without changing
   * RXO row cardinality. RXO identity is always the complete site/shipment/
   * direction tuple; shipment_id alone is deliberately never used here.
   */
  async withDriverDocumentState(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return rows;
    const requested = rows.map((row) => ({
      site_key: String(row.site_key ?? ''),
      shipment_id: String(row.shipment_id ?? ''),
      direction: String(row.direction ?? ''),
    }));
    const documentRows = await this.dataSource.query(
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
    // use saved East/West mappings, not the retired singleton printer.
    const agentId = this.config.get<string>('TRUCK_LOG_DRIVER_PRINT_AGENT_ID', '').trim() || 'trucklog-print-pc-01';
    const route = this.config.get<string>('TRUCK_LOG_DRIVER_PRINT_ROUTE', '').trim() || 'RXO_DRIVER_DOCUMENT';
    const value = Number(this.config.get('TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS', '90'));
    const seconds = Number.isInteger(value) && value >= 30 && value <= 3600 ? value : 90;
    const gateStatusRows = await this.dataSource.query(
      `SELECT EXISTS(SELECT 1 FROM print_agents agent
        WHERE agent.agent_id = $1 AND agent.enabled = TRUE
          AND agent.last_seen_at >= NOW() - ($2::int * INTERVAL '1 second')
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(agent.configured_routes) r
             WHERE r->>'route' = $3 AND r->>'outputPrinter' IN (
               SELECT value FROM app_settings WHERE key IN ('driver_print_east_printer', 'driver_print_west_printer')
                 AND value IS NOT NULL AND btrim(value) <> ''))
      ) AS online`, [agentId, seconds, route],
    ) as Array<{online: boolean}>;
    const agentOnline = gateStatusRows[0]?.online === true;
    return rows.map((row) => {
      const document = byIdentity.get(
        `${row.site_key}\u0000${row.shipment_id}\u0000${row.direction}`,
      );
      if (!document?.document_id) {
        return { ...row, driverDocument: { status: 'NO_DOCUMENT' } };
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
          uploadedAt: document.uploaded_at,
          printedAt: document.printed_at,
          agentOnline,
        },
      };
    });
  }

  async status() {
    const boundaryExists = fs.existsSync(rxoBoundaryPath(this.config));
    let boundary: Boundary | null = null;
    if (boundaryExists) {
      try { boundary = JSON.parse(fs.readFileSync(rxoBoundaryPath(this.config), 'utf8')) as Boundary; } catch { boundary = null; }
    }
    const lastImport = await this.dataSource.query(
      `SELECT source_batch_id,source_completed_at,site_key,site_name,status,dataset_count,
              order_rows,shipment_rows,freight_rows,linked_order_rows,scheduled_load_rows,
              deactivated_scheduled_load_rows,imported_at,error_message,dataset_summary
         FROM rxo_import_batches
        ORDER BY COALESCE(imported_at,updated_at) DESC LIMIT 1`,
    );
    const counts = await this.dataSource.query(
      `WITH plant_window AS (
         SELECT
           ((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE $1) - INTERVAL '1 day') AT TIME ZONE $1) AS starts_at,
           ((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE $1) + INTERVAL '2 days') AT TIME ZONE $1) AS ends_at
       )
       SELECT site_key,
              COUNT(*) FILTER (WHERE kind='ORDER' AND visible)::int AS orders_visible,
              COUNT(*) FILTER (WHERE kind='SHIPMENT' AND visible)::int AS shipments_visible,
              COUNT(*) FILTER (WHERE kind='FREIGHT' AND visible)::int AS freight_visible
         FROM (
           SELECT orders.site_key,'ORDER' kind,(
             orders.visible_in_latest=TRUE
             AND ${rxoOrderAvailableSql('orders')}
             AND LOWER(BTRIM(COALESCE(orders.status,''))) NOT IN ('delivered','complete','completed','cancelled','canceled','closed')
             AND CASE WHEN orders.direction='OUTBOUND' THEN orders.pickup_at ELSE orders.delivery_at END IS NOT NULL
             AND CASE WHEN orders.direction='OUTBOUND' THEN orders.pickup_at ELSE orders.delivery_at END >= plant_window.starts_at
             AND CASE WHEN orders.direction='OUTBOUND' THEN orders.pickup_at ELSE orders.delivery_at END < plant_window.ends_at
           ) visible FROM rxo_orders orders CROSS JOIN plant_window
           UNION ALL
           SELECT shipments.site_key,'SHIPMENT',(
             (shipments.shipment_visible_in_latest=TRUE OR shipments.freight_visible_in_latest=TRUE)
             AND ${rxoLoadAvailableSql('shipments.site_key', 'shipments.shipment_id', 'shipments.direction')}
             AND LOWER(BTRIM(COALESCE(shipments.current_status,shipments.shipment_status,''))) NOT IN ('delivered','complete','completed','cancelled','canceled','closed')
             AND shipments.plant_scheduled_at IS NOT NULL
             AND shipments.plant_scheduled_at >= plant_window.starts_at
             AND shipments.plant_scheduled_at < plant_window.ends_at
           ) FROM rxo_shipment_context shipments CROSS JOIN plant_window
           UNION ALL
           SELECT freight.site_key,'FREIGHT',(
             freight.visible_in_latest=TRUE
             AND ${rxoLoadAvailableSql('freight.site_key', 'freight.shipment_id', 'freight.direction')}
             AND LOWER(BTRIM(COALESCE(freight.status,''))) NOT IN ('delivered','complete','completed','cancelled','canceled','closed')
             AND freight.plant_scheduled_at IS NOT NULL
             AND freight.plant_scheduled_at >= plant_window.starts_at
             AND freight.plant_scheduled_at < plant_window.ends_at
           ) FROM rxo_freight_visibility freight CROSS JOIN plant_window
         ) rows
        GROUP BY site_key ORDER BY site_key`,
      [rxoPlantTimeZone(this.config)],
    );
    const [scheduleCount] = await this.dataSource.query(
      `WITH plant_window AS (
         SELECT
           ((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE $1) - INTERVAL '1 day') AT TIME ZONE $1) AS starts_at,
           ((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE $1) + INTERVAL '2 days') AT TIME ZONE $1) AS ends_at
       )
       SELECT COUNT(*)::int AS rxo_scheduled_loads
         FROM scheduled_loads,plant_window
        WHERE active=TRUE
          AND source LIKE 'RXO:%'
          AND ${scheduledLoadAvailableSql('scheduled_loads.load_number', 'scheduled_loads.source')}
          AND scheduled_at >= plant_window.starts_at
          AND scheduled_at < plant_window.ends_at`,
      [rxoPlantTimeZone(this.config)],
    );
    return {
      enabled: true,
      ordersCancelPolicy: { version: 'CANCEL_POLICY_1', header: 'Cancel', sourceColumnHint: 'CA',
        appliedOn: 'NEXT_SUCCESSFUL_NEW_BATCH', unknownFlags: 'REJECT_IMPORT' },
      latestRoot: rxoLatestRoot(this.config),
      boundaryExists,
      boundaryBatchId: boundary?.sourceBatchId ?? null,
      boundarySite: boundary?.site ?? null,
      boundaryCompletedAt: boundary?.sourceCompletedAt ?? null,
      boundaryPostgresImported: boundary?.postgresImported ?? false,
      lastImport: lastImport[0] ?? null,
      importHealth: rxoImportHealth(lastImport[0]),
      countsBySite: counts,
      rxoScheduledLoads: scheduleCount?.rxo_scheduled_loads ?? 0,
      authority: { rxo: 'planned/expected transportation context', truckLog: 'physical guard/dock lifecycle' },
    };
  }

  /** On-demand, read-only trace. Never imports, rescans, changes filters, or returns order/driver identifiers. */
  async ordersDiagnostics(site?: string) {
    const startedAt = new Date().toISOString();
    let boundary: Boundary | null = null;
    let boundaryError: string | null = null;
    try { boundary = this.snapshotReader.readBoundary(); }
    catch (error) { boundaryError = error instanceof Error ? error.message.slice(0, 500) : 'Boundary validation failed'; }
    const siteKey = normalizeRxoSite(site) ?? normalizeRxoSite(boundary?.site?.key) ?? 'fort-wayne';
    const timeZone = rxoPlantTimeZone(this.config);
    const [window] = await this.dataSource.query(
      `SELECT CURRENT_TIMESTAMP AS observed_at,
       ((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE $1) - INTERVAL '1 day') AT TIME ZONE $1) AS starts_at,
       ((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE $1) + INTERVAL '2 days') AT TIME ZONE $1) AS ends_at`, [timeZone],
    );
    const start = new Date(window.starts_at).getTime();
    const end = new Date(window.ends_at).getTime();
    const isInWindow = (date: Date | null) => !!date && date.getTime() >= start && date.getTime() < end;
    const batches = await this.dataSource.query(
      `SELECT source_batch_id,status,dataset_summary,imported_at,error_message
       FROM rxo_import_batches WHERE site_key=$1 ORDER BY COALESCE(imported_at,updated_at) DESC LIMIT 1`, [siteKey],
    );
    const importHealth = rxoImportHealth(batches[0]);
    const database = await this.dataSource.query(
      `WITH evaluated AS (
        SELECT orders.direction,orders.visible_in_latest,orders.source_batch_id,
          CASE WHEN orders.direction='OUTBOUND' THEN orders.pickup_at ELSE orders.delivery_at END AS site_time,
          (${activeRxoStatusClause('orders.status')}) AS active_status,
          (${rxoOrderAvailableSql('orders')}) AS available
        FROM rxo_orders orders WHERE orders.site_key=$1
      )
      SELECT direction,COUNT(*)::int AS stored,
        COUNT(*) FILTER (WHERE visible_in_latest)::int AS latest,
        COUNT(*) FILTER (WHERE visible_in_latest AND NOT active_status)::int AS terminal_excluded,
        COUNT(*) FILTER (WHERE visible_in_latest AND active_status AND site_time IS NULL)::int AS missing_date_excluded,
        COUNT(*) FILTER (WHERE visible_in_latest AND active_status AND site_time IS NOT NULL AND (site_time < $2 OR site_time >= $3))::int AS outside_window_excluded,
        COUNT(*) FILTER (WHERE visible_in_latest AND active_status AND site_time >= $2 AND site_time < $3 AND NOT available)::int AS checked_in_excluded,
        COUNT(*) FILTER (WHERE visible_in_latest AND active_status AND site_time >= $2 AND site_time < $3 AND available)::int AS eligible,
        ARRAY_AGG(DISTINCT source_batch_id) FILTER (WHERE visible_in_latest) AS retained_batches
      FROM evaluated GROUP BY direction`, [siteKey, window.starts_at, window.ends_at],
    );
    const directions: Record<string, unknown>[] = [];
    for (const direction of ['OUTBOUND', 'INBOUND'] as const) {
      const dataset = boundary?.datasets.find((entry) => entry.pageKey === 'orders' && entry.direction === direction);
      let workbook: Record<string, unknown> | null = null;
      if (dataset && boundary?.site?.key?.toLowerCase() === siteKey) {
        try {
          const file = path.resolve(rxoLatestRoot(this.config), dataset.relativePath);
          const beforeHash = this.snapshotReader.hashFile(file);
          const table = await this.snapshotReader.readWorkbook(file, 'orders');
          const filtered = this.snapshotReader.filterCancelledOrders(table, direction);
          const keyed = filtered.parsed;
          const unique = this.snapshotReader.dedupeOrders(keyed);
          const dates = (kind: 'pickupAt' | 'deliveryAt') => {
            const values = unique.map((row) => row[kind]?.toISOString()).filter((value): value is string => !!value).sort();
            return { parsed: values.length, missing: unique.length - values.length, earliest: values[0] ?? null, latest: values[values.length - 1] ?? null };
          };
          const dateSamples = Object.fromEntries(table.headers.filter((header) => /pickup|delivery/i.test(header) && /date|time|arrival/i.test(header)).map((header) => [header,
            [...new Set(table.rows.map((row) => this.snapshotReader.text(row[header]).slice(0, 80)).filter(Boolean))].slice(0, 5),
          ]));
          workbook = {
            sourceBatchId: boundary.sourceBatchId, file: dataset.relativePath, sha256: beforeHash,
            stableDuringRead: beforeHash === this.snapshotReader.hashFile(file), matchesBoundaryHash: !!dataset.sha256 && beforeHash === dataset.sha256.toLowerCase(),
            sheet: table.sheetName, headerRow: table.headerRow, sourceRows: table.rows.length, keyedRows: filtered.keyedRows, eligibleParsedRows: keyed.length,
            uniqueRows: unique.length, duplicatesCollapsed: keyed.length - unique.length,
            cancelFilterVersion: filtered.cancelFilterVersion,
            cancelHeader: filtered.cancelHeader, cancelColumnNumber: filtered.cancelColumnNumber,
            cancelledRowsSkipped: filtered.cancelledRowsSkipped,
            cancelledOrdersSkipped: filtered.cancelledOrdersSkipped,
            possibleExportCeiling: table.possibleExportCeiling,
            importDecision: table.possibleExportCeiling ? 'SKIPPED_POSSIBLE_RXO_EXPORT_CEILING' : 'BELOW_EXPORT_CEILING',
            pickup: dates('pickupAt'), delivery: dates('deliveryAt'), dateSamples,
            terminalRows: unique.filter((row) => this.snapshotReader.isTerminalStatus(row.status)).length,
            activeRowsInWindowBeforeCheckIn: unique.filter((row) => !this.snapshotReader.isTerminalStatus(row.status) && isInWindow(direction === 'OUTBOUND' ? row.pickupAt : row.deliveryAt)).length,
          };
        } catch (error) { workbook = { error: error instanceof Error ? error.message.slice(0, 500) : 'Workbook could not be inspected' }; }
      }
      const db = database.find((row: Record<string, unknown>) => row.direction === direction) ?? {
        direction, stored: 0, latest: 0, terminal_excluded: 0, missing_date_excluded: 0, outside_window_excluded: 0, checked_in_excluded: 0, eligible: 0, retained_batches: [],
      };
      const page = await this.listDataPage('orders', siteKey, direction, undefined, 1, 1);
      directions.push({ direction, siteTimeField: direction === 'OUTBOUND' ? 'pickup_at' : 'delivery_at', workbook, database: db,
        importDataset: importHealth.datasets.find((entry) => entry.pageKey === 'orders' && entry.direction === direction),
        api: { kind: page.kind, direction, total: page.total, matchesDatabaseEligible: Number(db.eligible) === page.total },
      });
    }
    let stableBoundary = false;
    try { stableBoundary = !!boundary && this.snapshotReader.boundarySourceHash(boundary) === this.snapshotReader.boundarySourceHash(this.snapshotReader.readBoundary()); } catch { /* Report instability; never mutate or import. */ }
    return {
      contractVersion: 1, source: 'RXO_REGULAR', readOnly: true, startedAt, completedAt: new Date().toISOString(), siteKey,
      directionRule: { Origin: 'OUTBOUND', Destination: 'INBOUND' },
      window: { timeZone, ...window, endExclusive: true },
      terminalStatuses: ['delivered', 'complete', 'completed', 'cancelled', 'canceled', 'closed'],
      checkInRule: 'Exact site/shipment/direction availability; all linked shipments must be consumed before an order is hidden.',
      boundary: { valid: !!boundary, error: boundaryError, stableDuringRead: stableBoundary, batchId: boundary?.sourceBatchId ?? null,
        completedAt: boundary?.sourceCompletedAt ?? null, matchesLatestImport: !!boundary && boundary.sourceBatchId === importHealth.batchId },
      importHealth, directions,
      limitations: ['Reads the verified server snapshot; exporter latest is collected separately by the CMD.', 'Database and API reads are sequential; concurrent imports/check-ins or a date rollover can change counts. Recollect if they disagree.', 'Source counts at or above 10,000 remain untrusted and are never imported by this trace.'],
    };
  }

  async listDataPage(
    kind?: string,
    site?: string,
    direction?: string,
    q?: string,
    page = 1,
    pageSize = 100,
  ) {
    return listRxoDataPage(
      {
        dataSource: this.dataSource,
        plantTimeZone: rxoPlantTimeZone(this.config),
        orderStopDate: (row, stop) => this.snapshotReader.orderStopDate(row, stop),
        withDriverDocumentState: (rows) => this.withDriverDocumentState(rows),
      },
      kind,
      site,
      direction,
      q,
      page,
      pageSize,
    );
  }

  async listShipments(site?: string, direction?: string, limit = 200) {
    const normalizedDirection = direction?.trim().toUpperCase();
    if (normalizedDirection && !['INBOUND', 'OUTBOUND'].includes(normalizedDirection)) {
      throw new BadRequestException('direction must be INBOUND or OUTBOUND.');
    }
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 1000) : 200;
    const clauses: string[] = [rxoLoadAvailableSql('rxo_shipment_context.site_key', 'rxo_shipment_context.shipment_id', 'rxo_shipment_context.direction')];
    const params: unknown[] = [];
    const siteKey = normalizeRxoSite(site);
    if (siteKey) { params.push(siteKey); clauses.push(`site_key=$${params.length}`); }
    if (normalizedDirection) { params.push(normalizedDirection); clauses.push(`direction=$${params.length}`); }
    params.push(safeLimit);
    return this.dataSource.query(
      `SELECT * FROM rxo_shipment_context
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY plant_scheduled_at NULLS LAST,shipment_id
        LIMIT $${params.length}`, params,
    );
  }

  async listOrders(site?: string, shipmentId?: string, direction?: string, limit = 500) {
    const clauses: string[] = [rxoOrderAvailableSql('rxo_orders')];
    const params: unknown[] = [];
    const siteKey = normalizeRxoSite(site);
    if (siteKey) { params.push(siteKey); clauses.push(`site_key=$${params.length}`); }
    if (shipmentId?.trim()) { params.push(shipmentId.trim().toUpperCase()); clauses.push(`UPPER(shipment_id)=$${params.length}`); }
    const normalizedDirection = direction?.trim().toUpperCase();
    if (normalizedDirection) {
      if (!['INBOUND', 'OUTBOUND'].includes(normalizedDirection)) throw new BadRequestException('direction must be INBOUND or OUTBOUND.');
      params.push(normalizedDirection); clauses.push(`direction=$${params.length}`);
    }
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 2000) : 500;
    params.push(safeLimit);
    return this.dataSource.query(
      `SELECT site_key,order_number,direction,shipment_id,status,origin_name,origin_address,
              destination_name,destination_address,pickup_at,delivery_at,customer_order_number,
              tracking_number,source_batch_id,visible_in_latest,last_seen_at
         FROM rxo_orders
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY COALESCE(pickup_at,delivery_at) NULLS LAST,order_number
        LIMIT $${params.length}`, params,
    );
  }

  async lookupShipment(shipmentId?: string, site?: string) {
    const normalized = shipmentId?.trim().toUpperCase();
    if (!normalized) throw new BadRequestException('shipmentId is required.');
    const siteKey = normalizeRxoSite(site);
    const params: unknown[] = [normalized];
    const siteClause = siteKey ? ' AND site_key=$2' : '';
    if (siteKey) params.push(siteKey);
    const shipments = await this.dataSource.query(
      `SELECT * FROM rxo_shipment_context WHERE UPPER(shipment_id)=$1${siteClause} ORDER BY site_key,direction`, params,
    );
    if (!shipments.length) throw new NotFoundException(`RXO shipment ${normalized} was not found.`);
    const orders = await this.dataSource.query(
      `SELECT links.site_key,links.order_number,links.direction,orders.status,orders.origin_name,
              orders.origin_address,orders.destination_name,orders.destination_address,
              orders.pickup_at,orders.delivery_at,orders.customer_order_number,orders.tracking_number,
              orders.visible_in_latest
         FROM rxo_order_shipment_links links
         LEFT JOIN rxo_orders orders
           ON orders.site_key=links.site_key AND orders.order_number=links.order_number AND orders.direction=links.direction
        WHERE UPPER(links.shipment_id)=$1${siteKey ? ' AND links.site_key=$2' : ''}
          AND links.visible_in_latest=TRUE
        ORDER BY links.site_key,links.direction,links.order_number`, params,
    );
    const scheduled = await this.dataSource.query(
      `SELECT id,load_number,scheduled_at,active,source FROM scheduled_loads
        WHERE active=TRUE AND UPPER(load_number)=$1
          AND ${scheduledLoadAvailableSql('scheduled_loads.load_number', 'scheduled_loads.source')} LIMIT 1`, [normalized],
    );
    return { shipmentId: normalized, shipments, orders, scheduledLoad: scheduled[0] ?? null };
  }
}
