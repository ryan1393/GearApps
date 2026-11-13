import { returnedRows } from '@truck-log/server/data-access';
import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthenticatedTruckLogPrincipal } from '@truck-log/server/auth/access';
import { ReprintRxoDocumentDto } from './dto/reprint-rxo-document.dto';
import { DriverPrintStore } from './driver-print.store';
import type { DriverPrintItemStatus, DriverPrintPackageSummary } from './driver-print.types';
import { boundedAuditActor, cleanOptional, requestDigest } from './driver-print.utils';

/**
 * Authorized RXO reprint of a legacy Driver Print Package: a separate audited
 * REPRINT package frozen to the original gate printer/agent/route, with
 * credential revalidation and access-idempotency replay.
 * A plain class constructed by DriverPrintService (not a Nest provider).
 */
export class DriverPrintReprint {
  constructor(
    private readonly dataSource: DataSource,
    private readonly store: DriverPrintStore,
  ) {}

  async reprintRxo(
    visitId: number,
    principal: AuthenticatedTruckLogPrincipal,
    idempotencyKey: string | undefined,
    input: ReprintRxoDocumentDto,
  ): Promise<DriverPrintPackageSummary> {
    this.store.assertIdempotencyKey(idempotencyKey);
    const digest = requestDigest({
      operation: 'RXO_DOCUMENT_REPRINT',
      keyId: principal.keyId,
      visitId,
      documentId: input.documentId,
      reason: cleanOptional(input.reason),
    });

    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `${principal.keyId}:${idempotencyKey}`,
      ]);
      const actors = returnedRows(await manager.query(
        `UPDATE truck_log_access_credentials
            SET last_used_at = NOW()
          WHERE key_id = $1
            AND active = TRUE
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > NOW())
            AND scopes @> '["rxo-documents:reprint"]'::jsonb
          RETURNING subject_id, display_name`,
        [principal.keyId],
      )) as Array<{ subject_id: string; display_name: string }>;
      const actor = actors[0];
      if (!actor) {
        throw new UnauthorizedException(
          'This Truck Log access credential is no longer authorized to reprint RXO documents.',
        );
      }
      const actorDisplayName = boundedAuditActor(actor.display_name)!;
      await manager.query(
        `DELETE FROM truck_log_access_idempotency
          WHERE key_id = $1
            AND idempotency_key = $2
            AND expires_at <= NOW()`,
        [principal.keyId, idempotencyKey],
      );
      const previous = await manager.query(
        `SELECT request_sha256, response_body
           FROM truck_log_access_idempotency
          WHERE key_id = $1 AND idempotency_key = $2`,
        [principal.keyId, idempotencyKey],
      );
      if (previous[0]) {
        if (previous[0].request_sha256 !== digest) {
          throw new ConflictException(
            'This X-Idempotency-Key was already used with a different reprint request.',
          );
        }
        return previous[0].response_body as DriverPrintPackageSummary;
      }

      const document = await this.store.requireRxoDocument(
        manager,
        visitId,
        input.documentId,
        false,
      );
      const originalPrinterRows = await manager.query(
        `SELECT item.printer, item.route, item.assigned_agent_id
             FROM driver_print_items item
             JOIN driver_print_packages package ON package.id = item.package_id
            WHERE package.truck_visit_id = $1
              AND package.request_kind = 'ORIGINAL'
              AND item.item_type = 'RXO_DOCUMENT'
              AND item.printer IS NOT NULL
            ORDER BY item.created_at DESC
            LIMIT 1`,
        [visitId],
      ) as Array<{ printer: string | null; route: string | null; assigned_agent_id: string | null }>;
      const originalPrinter = cleanOptional(originalPrinterRows[0]?.printer ?? '');
      if (!originalPrinter) throw new ServiceUnavailableException('The original gate printer could not be resolved for this visit.');
      const availability = await this.store.agentAvailability(manager, false, originalPrinter);
      if (availability.agentId !== originalPrinterRows[0]?.assigned_agent_id || availability.route !== originalPrinterRows[0]?.route) {
        throw new ServiceUnavailableException('The original gate agent/route changed. No automatic reroute is allowed.');
      }
      const packageId = randomUUID();
      const itemId = randomUUID();
      const requestId = randomUUID();
      const now = new Date();
      const itemStatus: DriverPrintItemStatus = availability.available
        ? 'QUEUED'
        : 'FAILED';
      const error = availability.available
        ? null
        : availability.error ?? 'The configured Driver Print Agent is unavailable.';

      await manager.query(
        `INSERT INTO driver_print_packages(
           id, truck_visit_id, request_kind, frozen_document_id,
           requested_by, requested_by_key_id, requested_at, status,
           request_id, created_at, updated_at
         ) VALUES ($1, $2, 'REPRINT', $3, $4, $5, $6, 'REQUESTED', $7, $6, $6)`,
        [
          packageId,
          visitId,
          document.id,
          actorDisplayName,
          principal.keyId,
          now,
          requestId,
        ],
      );
      await manager.query(
        `INSERT INTO driver_print_items(
           id, package_id, item_type, visit_document_id, status,
           route, printer, assigned_agent_id, attempt_count, last_error,
           created_at, updated_at
         ) VALUES ($1, $2, 'RXO_DOCUMENT', $3, $4, $5, $6, $7, 1, $8, $9, $9)`,
        [
          itemId,
          packageId,
          document.id,
          itemStatus,
          availability.route,
          availability.printer,
          availability.agentExists ? availability.agentId : null,
          error,
          now,
        ],
      );
      await manager.query(
        `INSERT INTO driver_print_attempts(
           id, item_id, attempt_number, attempt_kind, status, agent_id,
           route, printer, requested_at, completed_at, error_message,
           idempotency_key, details, created_at
         ) VALUES ($1, $2, 1, 'REPRINT', $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $7)`,
        [
          randomUUID(),
          itemId,
          availability.available ? 'REQUESTED' : 'FAILED',
          availability.agentExists ? availability.agentId : null,
          availability.route,
          availability.printer,
          now,
          availability.available ? null : now,
          error,
          idempotencyKey,
          JSON.stringify({ reason: cleanOptional(input.reason) }),
        ],
      );
      await this.store.insertDriverEvent(manager, {
        eventType: 'DRIVER_PRINT_PACKAGE_REQUESTED',
        actorType: 'HUMAN',
        actorId: actor.subject_id,
        actorKeyId: principal.keyId,
        truckVisitId: visitId,
        packageId,
        itemId,
        document,
        route: availability.route,
        printer: availability.printer,
        details: { requestKind: 'REPRINT', requestId, reason: cleanOptional(input.reason) },
      });
      await this.store.insertDriverEvent(manager, {
        eventType: 'RXO_DOCUMENT_REPRINTED',
        actorType: 'HUMAN',
        actorId: actor.subject_id,
        actorKeyId: principal.keyId,
        truckVisitId: visitId,
        packageId,
        itemId,
        document,
        route: availability.route,
        printer: availability.printer,
        error,
        details: {
          phase: 'REQUESTED',
          queued: availability.available,
          reason: cleanOptional(input.reason),
          idempotencyKey,
        },
      });
      await this.store.insertVisitEvent(
        manager,
        visitId,
        'RXO_DOCUMENT_REPRINTED',
        actorDisplayName,
        `Authorized reprint requested for RXO document ${document.id} version ${document.documentVersion}.${
          error ? ` ${error}` : ''
        }`,
        now,
      );
      if (error) {
        await this.store.insertDriverEvent(manager, {
          eventType: 'RXO_DOCUMENT_PRINT_FAILED',
          actorType: 'SYSTEM',
          actorId: 'TRUCK_LOG_PRINT_QUEUE',
          truckVisitId: visitId,
          packageId,
          itemId,
          document,
          route: availability.route,
          printer: availability.printer,
          error,
          details: { phase: 'QUEUE', reprint: true, retryRequired: true },
        });
        await this.store.insertVisitEvent(
          manager,
          visitId,
          'RXO_DOCUMENT_PRINT_FAILED',
          'TRUCK_LOG_PRINT_QUEUE',
          error,
          now,
        );
      }
      await this.store.refreshPackageStatus(manager, packageId);
      const response = await this.store.summaryByPackageId(manager, packageId);
      await manager.query(
        `INSERT INTO truck_log_access_idempotency(
           key_id, idempotency_key, request_sha256, response_status, response_body
         ) VALUES ($1, $2, $3, 200, $4::jsonb)`,
        [principal.keyId, idempotencyKey, digest, JSON.stringify(response)],
      );
      return response;
    });
  }
}
