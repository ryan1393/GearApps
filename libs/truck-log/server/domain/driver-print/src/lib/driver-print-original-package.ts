import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { DriverPrintStore } from './driver-print.store';
import type { DriverPrintItemStatus, DriverPrintPackageSummary } from './driver-print.types';
import { SYSTEM_CHECK_IN_ACTOR } from './driver-print.types';
import { boundedAuditActor } from './driver-print.utils';

/**
 * Creates the original legacy Driver Print Package (browser-confirmed Dock
 * Assignment item + agent-printed RXO item) inside the visit-creation or
 * RXO-upload transaction. Automatic packages are handled by
 * AutomaticDriverPrintService before this runs.
 * A plain class constructed by DriverPrintService (not a Nest provider).
 */
export class DriverPrintOriginalPackage {
  constructor(private readonly store: DriverPrintStore) {}

  /**
   * Called from the visit-creation transaction after the active RXO document
   * has been deterministically attached to the visit. The frozen document id,
   * package, both items, attempts, and audit records commit atomically with the
   * visit. A browser print dialog is never treated as proof of printing.
   */
  async createOriginalPackage(
    manager: EntityManager,
    visitId: number,
    frozenDocumentId: number,
    requestedBy: string | null,
    guardGate: 'EAST' | 'WEST' | null = null,
  ): Promise<DriverPrintPackageSummary> {
    await this.store.lockAction(manager, `driver-print-original:${visitId}`);
    const existing = await manager.query(
      `SELECT id, frozen_document_id
         FROM driver_print_packages
        WHERE truck_visit_id = $1 AND request_kind = 'ORIGINAL'
        FOR UPDATE`,
      [visitId],
    );
    if (existing[0]) {
      if (Number(existing[0].frozen_document_id) !== frozenDocumentId) {
        throw new ConflictException(
          'This visit already has an original Driver Print Package frozen to a different RXO document version.',
        );
      }
      return this.store.summaryByPackageId(manager, String(existing[0].id));
    }

    const document = await this.store.requireRxoDocument(
      manager,
      visitId,
      frozenDocumentId,
      true,
    );
    const gatePrinter = await this.store.gatePrinterSetting(manager, guardGate);
    const availability = await this.store.agentAvailability(manager, false, gatePrinter);
    const packageId = randomUUID();
    const requestId = randomUUID();
    const dockItemId = randomUUID();
    const rxoItemId = randomUUID();
    const now = new Date();
    const requestedBySnapshot = boundedAuditActor(requestedBy);
    const rxoStatus: DriverPrintItemStatus = availability.available
      ? 'QUEUED'
      : 'FAILED';
    const rxoError = availability.available
      ? null
      : availability.error ?? 'The configured Driver Print Agent is unavailable.';

    await manager.query(
      `INSERT INTO driver_print_packages(
         id, truck_visit_id, request_kind, frozen_document_id,
         requested_by, requested_by_key_id, requested_at, status,
         request_id, created_at, updated_at
       ) VALUES ($1, $2, 'ORIGINAL', $3, $4, NULL, $5, 'REQUESTED', $6, $5, $5)`,
      [packageId, visitId, frozenDocumentId, requestedBySnapshot, now, requestId],
    );
    await manager.query(
      `INSERT INTO driver_print_items(
         id, package_id, item_type, visit_document_id, status,
         attempt_count, created_at, updated_at
       ) VALUES ($1, $2, 'DOCK_ASSIGNMENT', NULL, 'PENDING_CONFIRMATION', 1, $3, $3)`,
      [dockItemId, packageId, now],
    );
    await manager.query(
      `INSERT INTO driver_print_items(
         id, package_id, item_type, visit_document_id, status,
         route, printer, assigned_agent_id, attempt_count, last_error,
         created_at, updated_at
       ) VALUES ($1, $2, 'RXO_DOCUMENT', $3, $4, $5, $6, $7, 1, $8, $9, $9)`,
      [
        rxoItemId,
        packageId,
        frozenDocumentId,
        rxoStatus,
        availability.route,
        availability.printer,
        availability.agentExists ? availability.agentId : null,
        rxoError,
        now,
      ],
    );
    await manager.query(
      `INSERT INTO driver_print_attempts(
         id, item_id, attempt_number, attempt_kind, status,
         requested_at, idempotency_key, details, created_at
       ) VALUES ($1, $2, 1, 'CONFIRMATION', 'REQUESTED', $3, $4, $5::jsonb, $3)`,
      [
        randomUUID(),
        dockItemId,
        now,
        `confirmation-${dockItemId}`,
        JSON.stringify({ source: 'GUARD_BROWSER' }),
      ],
    );
    await manager.query(
      `INSERT INTO driver_print_attempts(
         id, item_id, attempt_number, attempt_kind, status, agent_id,
         route, printer, requested_at, completed_at, error_message,
         idempotency_key, details, created_at
       ) VALUES ($1, $2, 1, 'ORIGINAL', $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $7)`,
      [
        randomUUID(),
        rxoItemId,
        availability.available ? 'REQUESTED' : 'FAILED',
        availability.agentExists ? availability.agentId : null,
        availability.route,
        availability.printer,
        now,
        availability.available ? null : now,
        rxoError,
        `original-${rxoItemId}`,
        JSON.stringify({ serverOwnedRoute: true, serverOwnedPrinter: true }),
      ],
    );
    await manager.query(
      `UPDATE visit_documents
          SET print_status = $2,
              print_error = $3,
              updated_at = $4
        WHERE id = $1`,
      [
        frozenDocumentId,
        availability.available ? 'PENDING' : 'FAILED',
        rxoError,
        now,
      ],
    );

    await this.store.insertDriverEvent(manager, {
      eventType: 'DRIVER_PRINT_PACKAGE_REQUESTED',
      actorType: 'SYSTEM',
      actorId: SYSTEM_CHECK_IN_ACTOR,
      truckVisitId: visitId,
      packageId,
      document,
      route: availability.route,
      printer: availability.printer,
      details: {
        requestKind: 'ORIGINAL',
        requestId,
        legacyRequestedBy: requestedBySnapshot,
      },
    });
    await this.store.insertVisitEvent(
      manager,
      visitId,
      'DRIVER_PRINT_PACKAGE_REQUESTED',
      SYSTEM_CHECK_IN_ACTOR,
      `Original Driver Print Package ${packageId} froze RXO document ${frozenDocumentId} version ${document.documentVersion}.`,
      now,
    );

    if (rxoError) {
      await this.store.insertDriverEvent(manager, {
        eventType: 'RXO_DOCUMENT_PRINT_FAILED',
        actorType: 'SYSTEM',
        actorId: SYSTEM_CHECK_IN_ACTOR,
        truckVisitId: visitId,
        packageId,
        itemId: rxoItemId,
        document,
        route: availability.route,
        printer: availability.printer,
        error: rxoError,
        details: { phase: 'QUEUE', retryRequired: true },
      });
      await this.store.insertVisitEvent(
        manager,
        visitId,
        'RXO_DOCUMENT_PRINT_FAILED',
        SYSTEM_CHECK_IN_ACTOR,
        rxoError,
        now,
      );
    }

    await this.store.refreshPackageStatus(manager, packageId);
    return this.store.summaryByPackageId(manager, packageId);
  }
}
