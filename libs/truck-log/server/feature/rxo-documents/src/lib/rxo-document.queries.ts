import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { RxoShipmentIdentity } from '@truck-log/server/domain/rxo';

import {
  DEFAULT_HISTORY_LIMIT,
  MATERIALS_UPLOAD_SOURCE,
  MAX_HISTORY_LIMIT,
  RXO_DRIVER_DOCUMENT_TYPE,
  asIso,
  asNumber,
  normalizeIdentity,
  printStatusFor,
  type Queryable,
  type RxoDocumentRow,
} from './rxo-document.model';

/**
 * Read side of RXO driver documents: shipment ownership checks, version
 * history paging, and the response shapes shared by status and upload.
 * A plain class constructed by RxoDocumentsService (not a Nest provider).
 */
export class RxoDocumentQueries {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async status(
    siteKey: string,
    direction: string,
    shipmentId: string,
    historyBeforeVersion?: string,
    historyLimit?: string,
  ) {
    const identity = normalizeIdentity(siteKey, direction, shipmentId);
    const page = this.historyPage(historyBeforeVersion, historyLimit);
    await this.assertShipmentExists(this.dataSource, identity);
    const latestRows = await this.documentRows(this.dataSource, identity, null, 1);
    const active = latestRows[0];
    if (
      active
      && (
        active.rxo_is_active !== true
        || Number(active.active_total) !== 1
      )
    ) {
      throw new ConflictException(
        'RXO driver-document history has no single active latest version.',
      );
    }
    const historyWithSentinel = await this.documentRows(
      this.dataSource,
      identity,
      page.beforeVersion,
      page.limit + 1,
    );
    const hasMoreHistory = historyWithSentinel.length > page.limit;
    const history = historyWithSentinel.slice(0, page.limit);
    const nextHistoryBeforeVersion = hasMoreHistory && history.length > 0
      ? Number(history[history.length - 1].rxo_document_version)
      : null;
    return this.stateResponse(
      identity,
      active,
      await this.printAgentOnline(this.dataSource),
      {
        rows: history,
        total: active ? Number(active.history_total) : 0,
        hasMore: hasMoreHistory,
        nextBeforeVersion: nextHistoryBeforeVersion,
      },
    );
  }

  async assertShipmentExists(
    queryable: Queryable,
    identity: RxoShipmentIdentity,
  ): Promise<void> {
    const rows = identity.siteKey === 'fort-wayne-expedite'
      ? await queryable.query(
        `SELECT 'fort-wayne-expedite'::text AS site_key,
                snapshot.shipment_id,
                snapshot.direction
           FROM rxo_expedite_shipment_snapshots snapshot
           JOIN rxo_expedite_import_batches batch
             ON batch.source_batch_id = snapshot.source_batch_id
          WHERE batch.status = 'COMPLETE'
            AND snapshot.source_batch_id = (
              SELECT source_batch_id
                FROM rxo_expedite_import_batches
               WHERE status = 'COMPLETE'
               ORDER BY imported_at DESC NULLS LAST,
                        source_completed_at DESC,
                        source_batch_id DESC
               LIMIT 1
            )
            AND snapshot.shipment_id = $1
            AND snapshot.direction = $2
          LIMIT 2`,
        [identity.shipmentId, identity.direction],
      )
      : await queryable.query(
        `SELECT site_key, shipment_id, direction
           FROM rxo_shipment_context
          WHERE site_key = $1
            AND shipment_id = $2
            AND direction = $3
          LIMIT 2`,
        [identity.siteKey, identity.shipmentId, identity.direction],
      );
    if (!rows[0]) {
      throw new NotFoundException(
        identity.siteKey === 'fort-wayne-expedite'
          ? 'The exact current Expedite shipment and direction were not found in the latest complete PostgreSQL batch.'
          : 'The exact RXO site, shipment, and direction tuple was not found.',
      );
    }
    if (rows.length !== 1) {
      throw new ConflictException(
        'The exact RXO shipment tuple is ambiguous; Truck Log did not guess document ownership.',
      );
    }
  }

  async documentRows(
    queryable: Queryable,
    identity: RxoShipmentIdentity,
    beforeVersion: number | null = null,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<RxoDocumentRow[]> {
    return queryable.query(
      `SELECT document.id,
              document.truck_visit_id,
              document.file_name,
              document.mime_type,
              document.file_size_bytes,
              document.sha256,
              document.scanned_at,
              document.rxo_document_version,
              document.rxo_is_active,
              document.uploaded_by_key_id,
              uploader.subject_id AS uploader_subject_id,
              uploader.display_name AS uploader_display_name,
              document.association_status,
              document.association_method,
              document.association_reason,
              document.review_status,
              document.review_reason,
              document.supersedes_document_id,
              document.superseded_at,
              latest_print.status AS latest_print_status,
              latest_print.last_error AS latest_print_error,
              latest_print.route AS latest_print_route,
              latest_print.printer AS latest_print_printer,
              latest_print.assigned_agent_id AS latest_print_agent_id,
              printed.printed_at,
              COUNT(*) OVER () AS history_total,
              COUNT(*) FILTER (WHERE document.rxo_is_active = TRUE) OVER () AS active_total
         FROM visit_documents document
         LEFT JOIN truck_log_access_credentials uploader
           ON uploader.key_id = document.uploaded_by_key_id
         LEFT JOIN LATERAL (
           SELECT item.status,
                  item.last_error,
                  item.route,
                  item.printer,
                  item.assigned_agent_id
             FROM automatic_driver_print_history_v1 item
            WHERE item.visit_document_id = document.id
              AND item.item_type = 'RXO_DOCUMENT'
            ORDER BY item.updated_at DESC, item.created_at DESC, item.id DESC
            LIMIT 1
         ) latest_print ON TRUE
         LEFT JOIN LATERAL (
           SELECT MAX(item.printed_at) AS printed_at
             FROM automatic_driver_print_history_v1 item
            WHERE item.visit_document_id = document.id
              AND item.item_type = 'RXO_DOCUMENT'
              AND item.status = 'PRINTED'
         ) printed ON TRUE
        WHERE document.rxo_site_key = $1
          AND document.rxo_shipment_id = $2
          AND document.rxo_direction = $3
          AND document.document_type = $4
          AND document.source_kind = $5
          AND ($6::int IS NULL OR document.rxo_document_version < $6)
        ORDER BY document.rxo_document_version DESC
        LIMIT $7`,
      [
        identity.siteKey,
        identity.shipmentId,
        identity.direction,
        RXO_DRIVER_DOCUMENT_TYPE,
        MATERIALS_UPLOAD_SOURCE,
        beforeVersion,
        limit,
      ],
    ) as Promise<RxoDocumentRow[]>;
  }

  mapDocument(row: RxoDocumentRow) {
    return {
      documentId: Number(row.id),
      version: Number(row.rxo_document_version),
      isActive: row.rxo_is_active === true,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSizeBytes: asNumber(row.file_size_bytes),
      sha256: row.sha256,
      uploadedAt: asIso(row.scanned_at),
      uploadedBy: {
        displayName: row.uploader_display_name ?? null,
      },
      visitId: asNumber(row.truck_visit_id),
      associationStatus: row.association_status,
      associationMethod: row.association_method,
      associationReason: row.association_reason,
      reviewStatus: row.review_status,
      reviewReason: row.review_reason,
      supersedesDocumentId: asNumber(row.supersedes_document_id),
      supersededAt: asIso(row.superseded_at),
      status: printStatusFor(row),
      printedAt: asIso(row.printed_at),
      latestPrint: row.latest_print_status
        ? {
            status: row.latest_print_status,
            error: row.latest_print_error ?? null,
            route: row.latest_print_route ?? null,
            printer: row.latest_print_printer ?? null,
            agentId: row.latest_print_agent_id ?? null,
          }
        : null,
    };
  }

  stateResponse(
    identity: RxoShipmentIdentity,
    active: RxoDocumentRow | undefined,
    agentOnline: boolean,
    historyPage?: {
      rows: RxoDocumentRow[];
      total: number;
      hasMore: boolean;
      nextBeforeVersion: number | null;
    },
  ): Record<string, unknown> {
    const response: Record<string, unknown> = {
      status: printStatusFor(active),
      activeDocumentId: active ? Number(active.id) : null,
      version: active ? Number(active.rxo_document_version) : null,
      fileName: active?.file_name ?? null,
      uploadedAt: active ? asIso(active.scanned_at) : null,
      printedAt: active ? asIso(active.printed_at) : null,
      agentOnline,
      shipment: identity,
      activeDocument: active ? this.mapDocument(active) : null,
    };
    if (historyPage) {
      response.history = historyPage.rows.map((row) => this.mapDocument(row));
      response.historyTotal = historyPage.total;
      response.hasMoreHistory = historyPage.hasMore;
      response.nextHistoryBeforeVersion = historyPage.nextBeforeVersion;
    }
    return response;
  }

  async uploadResponse(
    queryable: Queryable,
    identity: RxoShipmentIdentity,
    documentId: number,
    duplicate: boolean,
  ): Promise<Record<string, unknown>> {
    const rows = await this.documentRows(queryable, identity, null, 1);
    const document = rows.find((row) => Number(row.id) === documentId);
    if (!document) {
      throw new ConflictException(
        'The RXO driver document could not be read after upload.',
      );
    }
    return {
      accepted: true,
      duplicate,
      documentId,
      ...this.stateResponse(
        identity,
        document,
        await this.printAgentOnline(queryable),
      ),
    };
  }

  async printAgentOnline(queryable: Queryable): Promise<boolean> {
    const agentId = this.config.get<string>('TRUCK_LOG_DRIVER_PRINT_AGENT_ID', '').trim() || 'trucklog-print-pc-01';
    const route = this.config.get<string>('TRUCK_LOG_DRIVER_PRINT_ROUTE', '').trim() || 'RXO_DRIVER_DOCUMENT';
    const value = Number(this.config.get('TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS', '90'));
    const seconds = Number.isInteger(value) && value >= 30 && value <= 3600 ? value : 90;
    const rows = await queryable.query(
      `SELECT EXISTS(SELECT 1 FROM print_agents agent
        WHERE agent.agent_id = $1 AND agent.enabled = TRUE
          AND agent.last_seen_at >= NOW() - ($2::int * INTERVAL '1 second')
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(agent.configured_routes) r
             WHERE r->>'route' = $3 AND r->>'outputPrinter' IN (
               SELECT value FROM app_settings WHERE key IN ('driver_print_east_printer', 'driver_print_west_printer')
                 AND value IS NOT NULL AND btrim(value) <> ''))
      ) AS online`, [agentId, seconds, route],
    ) as Array<{online: boolean}>;
    return rows[0]?.online === true;
  }

  historyPage(
    beforeVersionValue: string | undefined,
    limitValue: string | undefined,
  ): { beforeVersion: number | null; limit: number } {
    let beforeVersion: number | null = null;
    if (beforeVersionValue !== undefined && beforeVersionValue !== '') {
      if (!/^[1-9][0-9]*$/.test(beforeVersionValue)) {
        throw new BadRequestException(
          'historyBeforeVersion must be a positive document version.',
        );
      }
      beforeVersion = Number(beforeVersionValue);
      if (!Number.isSafeInteger(beforeVersion)) {
        throw new BadRequestException(
          'historyBeforeVersion must be a positive document version.',
        );
      }
    }
    let limit = DEFAULT_HISTORY_LIMIT;
    if (limitValue !== undefined && limitValue !== '') {
      if (!/^[1-9][0-9]*$/.test(limitValue)) {
        throw new BadRequestException(
          `historyLimit must be between 1 and ${MAX_HISTORY_LIMIT}.`,
        );
      }
      limit = Number(limitValue);
      if (!Number.isSafeInteger(limit) || limit > MAX_HISTORY_LIMIT) {
        throw new BadRequestException(
          `historyLimit must be between 1 and ${MAX_HISTORY_LIMIT}.`,
        );
      }
    }
    return { beforeVersion, limit };
  }
}
