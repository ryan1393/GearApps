import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DriverPrintService } from '@truck-log/server/domain/driver-print';
import {
  SapDocumentStorageService,
  type StoredSapDocumentPdf,
} from '@truck-log/server/infrastructure/sap-documents';
import type { RxoShipmentIdentity } from '@truck-log/server/domain/rxo';
import { exactlyOneRowUpdated, returnedRows } from '@truck-log/server/data-access';

import {
  MATERIALS_UPLOAD_SOURCE,
  RXO_CHECK_IN_RACE_GRACE_MS,
  RXO_DRIVER_DOCUMENT_TYPE,
  asNumber,
  mapStorageError,
  type ActiveDocumentRow,
  type CredentialRow,
  type LinkedVisitRow,
} from './rxo-document.model';
import { rememberIdempotentResponse } from './rxo-document-idempotency.store';
import type { RxoDocumentQueries } from './rxo-document.queries';
import type { UploadedRxoDriverDocumentFile } from './rxo-document-pdf-validation';

export interface RxoDocumentUploadInput {
  identity: RxoShipmentIdentity;
  file: UploadedRxoDriverDocumentFile | undefined;
  pdfSha256: string;
  actor: CredentialRow;
  idempotencyKey: string;
  requestSha256: string;
  now: Date;
}

/**
 * Write side of an RXO driver-document upload, run inside the caller's
 * transaction after the shipment and idempotency locks are held and any
 * idempotent replay has been answered: verifies the shipment and the single
 * active version, stores the immutable PDF, supersedes the previous version,
 * associates the exact linked visit, writes audit events, and remembers the
 * idempotent response. `staged.stored` is set as soon as a file exists so the
 * caller can remove it if the transaction does not commit.
 *
 * A plain class constructed by RxoDocumentsService (not a Nest provider).
 */
export class RxoDocumentUploadCommand {
  constructor(
    private readonly storage: SapDocumentStorageService,
    private readonly driverPrint: DriverPrintService,
    private readonly queries: RxoDocumentQueries,
  ) {}

  async storeNewVersion(
    manager: EntityManager,
    input: RxoDocumentUploadInput,
    staged: { stored: StoredSapDocumentPdf | null },
  ): Promise<Record<string, unknown>> {
    const { identity, file, pdfSha256, actor, idempotencyKey, requestSha256, now } = input;
    let stored: StoredSapDocumentPdf | null = null;
    await this.queries.assertShipmentExists(manager, identity);
    const activeRows = await manager.query(
      `SELECT document.id,
              document.truck_visit_id,
              document.file_name,
              document.stored_file_name,
              document.relative_path,
              document.mime_type,
              document.file_size_bytes,
              document.sha256,
              document.scanned_at,
              document.rxo_document_version,
              document.rxo_is_active,
              document.uploaded_by_key_id,
              document.association_status,
              document.association_method,
              document.association_reason,
              document.review_status,
              document.review_reason,
              document.supersedes_document_id,
              document.superseded_at
         FROM visit_documents document
        WHERE document.rxo_site_key = $1
          AND document.rxo_shipment_id = $2
          AND document.rxo_direction = $3
          AND document.document_type = $4
          AND document.source_kind = $5
          AND document.rxo_is_active = TRUE
        FOR UPDATE OF document`,
      [
        identity.siteKey,
        identity.shipmentId,
        identity.direction,
        RXO_DRIVER_DOCUMENT_TYPE,
        MATERIALS_UPLOAD_SOURCE,
      ],
    ) as ActiveDocumentRow[];
    if (activeRows.length > 1) {
      throw new ConflictException(
        'More than one active RXO driver document exists for this shipment.',
      );
    }
    const active = activeRows[0];

    const latestRows = await manager.query(
      `SELECT id, rxo_document_version, rxo_is_active
         FROM visit_documents
        WHERE rxo_site_key = $1
          AND rxo_shipment_id = $2
          AND rxo_direction = $3
          AND document_type = $4
          AND source_kind = $5
        ORDER BY rxo_document_version DESC
        LIMIT 1
        FOR UPDATE`,
      [
        identity.siteKey,
        identity.shipmentId,
        identity.direction,
        RXO_DRIVER_DOCUMENT_TYPE,
        MATERIALS_UPLOAD_SOURCE,
      ],
    ) as Array<{
      id: number | string;
      rxo_document_version: number | string;
      rxo_is_active: boolean;
    }>;
    const latest = latestRows[0];
    if (latest && (!active || Number(latest.id) !== Number(active.id))) {
      throw new ConflictException(
        'RXO driver-document history has no single active latest version; upload was stopped.',
      );
    }

    if (active?.sha256 === pdfSha256) {
      const body = await this.queries.uploadResponse(
        manager,
        identity,
        Number(active.id),
        true,
      );
      await rememberIdempotentResponse(
        manager,
        actor.key_id,
        idempotencyKey,
        requestSha256,
        body,
      );
      return body;
    }

    const linkedVisits = await manager.query(
      `SELECT id, manual_printing,
              status = 'DOCK_ASSIGNED'
                AND guard_check_out_at IS NULL
                AND guard_check_in_at >= $4 AS eligible_for_initial_package
         FROM truck_visits
        WHERE rxo_site_key = $1
          AND rxo_shipment_id = $2
          AND rxo_direction = $3
        ORDER BY id
        LIMIT 2
        FOR KEY SHARE`,
      [
        identity.siteKey,
        identity.shipmentId,
        identity.direction,
        new Date(now.getTime() - RXO_CHECK_IN_RACE_GRACE_MS),
      ],
    ) as LinkedVisitRow[];
    const linkedVisitId = linkedVisits.length === 1
      ? Number(linkedVisits[0].id)
      : null;
    const ambiguousVisitAssociation = linkedVisits.length > 1;
    const nextVersion = active
      ? Number(active.rxo_document_version) + 1
      : 1;

    try {
      stored = await this.storage.storeRxoPdf({
        buffer: file!.buffer,
        originalName: file!.originalname,
        mimeType: file!.mimetype,
        capturedAt: now,
      });
    } catch (error) {
      mapStorageError(error);
    }
    staged.stored = stored;
    if (!stored) {
      throw new Error('RXO document storage did not return a stored PDF.');
    }

    if (active) {
      const superseded = returnedRows(await manager.query(
        `UPDATE visit_documents
            SET rxo_is_active = FALSE,
                is_authoritative = FALSE,
                superseded_at = $2,
                updated_at = $2
          WHERE id = $1
            AND rxo_is_active = TRUE
            AND superseded_at IS NULL
          RETURNING id`,
        [active.id, now],
      ));
      if (!exactlyOneRowUpdated(superseded, active.id)) {
        throw new ConflictException(
          'The active RXO driver document changed while replacement was starting.',
        );
      }
    }

    const reviewStatus = ambiguousVisitAssociation
      ? 'NEEDS_REVIEW'
      : 'NOT_APPLICABLE';
    const reviewReason = ambiguousVisitAssociation
      ? 'More than one Truck Log visit is linked to this exact RXO shipment tuple; Truck Log did not guess.'
      : null;
    const associationStatus = linkedVisitId === null ? 'UNMATCHED' : 'ASSOCIATED';
    const associationMethod = linkedVisitId === null ? null : 'RXO_EXACT_TUPLE';
    const associationReason = linkedVisitId === null
      ? ambiguousVisitAssociation
        ? reviewReason
        : 'No Truck Log visit is linked to this RXO shipment yet.'
      : 'Exactly one Truck Log visit matched the complete RXO site, shipment, and direction tuple.';
    const inserted = await manager.query(
      `INSERT INTO visit_documents(
         truck_visit_id,
         file_name,
         original_file_name,
         stored_file_name,
         relative_path,
         document_type,
         sap_document_type_code,
         mime_type,
         file_size_bytes,
         extraction_status,
         scanned_at,
         scanned_by,
         created_at,
         source_kind,
         source_agent_id,
         source_capture_id,
         sha256,
         captured_at,
         print_status,
         validation_status,
         review_status,
         review_reason,
         association_status,
         association_method,
         associated_at,
         associated_by,
         association_reason,
         is_authoritative,
         supersedes_document_id,
         superseded_at,
         storage_status,
         retention_status,
         updated_at,
         rxo_site_key,
         rxo_shipment_id,
         rxo_direction,
         rxo_document_version,
         rxo_is_active,
         uploaded_by_key_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, NULL, 'application/pdf', $7,
         'NOT_APPLICABLE', $8, $9, $8, $10, NULL, NULL, $11, $8,
         'NOT_APPLICABLE', 'NOT_APPLICABLE', $12, $13, $14, $15,
         $16, $17, $18, TRUE, $19, NULL, 'STORED', 'ACTIVE', $8,
         $20, $21, $22, $23, TRUE, $24
       )
       RETURNING id`,
      [
        linkedVisitId,
        stored.fileName,
        file!.originalname,
        stored.storedFileName,
        stored.relativePath,
        RXO_DRIVER_DOCUMENT_TYPE,
        stored.fileSizeBytes,
        now,
        actor.subject_id,
        MATERIALS_UPLOAD_SOURCE,
        stored.sha256,
        reviewStatus,
        reviewReason,
        associationStatus,
        associationMethod,
        linkedVisitId === null ? null : now,
        linkedVisitId === null ? null : actor.subject_id,
        associationReason,
        active?.id ?? null,
        identity.siteKey,
        identity.shipmentId,
        identity.direction,
        nextVersion,
        actor.key_id,
      ],
    );
    const documentId = Number(inserted[0].id);
    const commonAuditDetails = {
      actorDisplayName: actor.display_name,
      actorKeyId: actor.key_id,
      documentId,
      documentVersion: nextVersion,
      previousDocumentId: active ? Number(active.id) : null,
      previousVersion: active ? Number(active.rxo_document_version) : null,
      siteKey: identity.siteKey,
      shipmentId: identity.shipmentId,
      direction: identity.direction,
      originalFileName: file!.originalname,
      fileName: stored.fileName,
      fileSizeBytes: stored.fileSizeBytes,
      sha256: stored.sha256,
      associationStatus,
      visitId: linkedVisitId,
      previousVisitId: active ? asNumber(active.truck_visit_id) : null,
    };

    await this.audit(
      manager,
      documentId,
      active ? 'RXO_DOCUMENT_REPLACED' : 'RXO_DOCUMENT_UPLOADED',
      actor,
      now,
      null,
      null,
      active
        ? `RXO driver-document version ${nextVersion} replaced version ${nextVersion - 1}.`
        : 'RXO driver-document version 1 was uploaded by Materials.',
      commonAuditDetails,
    );
    if (active) {
      await this.audit(
        manager,
        Number(active.id),
        'RXO_DOCUMENT_SUPERSEDED',
        actor,
        now,
        null,
        null,
        `RXO driver-document version ${nextVersion - 1} was superseded by version ${nextVersion}.`,
        commonAuditDetails,
      );
    }
    if (linkedVisitId !== null) {
      await this.audit(
        manager,
        documentId,
        'RXO_DOCUMENT_ASSOCIATED_TO_VISIT',
        actor,
        now,
        null,
        linkedVisitId,
        associationReason,
        commonAuditDetails,
      );

      const originalPackages = await manager.query(
        `SELECT id
           FROM driver_print_packages
          WHERE truck_visit_id = $1
            AND request_kind = 'ORIGINAL'
          LIMIT 1
          FOR KEY SHARE`,
        [linkedVisitId],
      );
      const canCreateRacePackage = linkedVisits.length === 1
        && linkedVisits[0].eligible_for_initial_package === true;
      const automaticItems = await manager.query(
        `SELECT j.id FROM automatic_driver_print_packages p
         JOIN automatic_driver_print_jobs j ON j.package_id=p.id AND j.item_type='RXO_DOCUMENT'
         WHERE p.truck_visit_id=$1 AND p.request_kind='ORIGINAL' LIMIT 1`, [linkedVisitId]);
      if (originalPackages.length === 0 && automaticItems.length === 0 && canCreateRacePackage
          && linkedVisits[0].manual_printing !== true) {
        await this.driverPrint.createOriginalPackage(
          manager,
          linkedVisitId,
          documentId,
          actor.display_name,
        );
      }
    }

    const body = await this.queries.uploadResponse(
      manager,
      identity,
      documentId,
      false,
    );
    await rememberIdempotentResponse(
      manager,
      actor.key_id,
      idempotencyKey,
      requestSha256,
      body,
    );
    return body;
  }

  private async audit(
    manager: EntityManager,
    documentId: number,
    eventType: string,
    actor: CredentialRow,
    occurredAt: Date,
    fromVisitId: number | null,
    toVisitId: number | null,
    reason: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO sap_document_events(
         visit_document_id,
         event_type,
         occurred_at,
         actor_type,
         actor_id,
         from_visit_id,
         to_visit_id,
         reason,
         details,
         created_at
       ) VALUES ($1, $2, $3, 'HUMAN', $4, $5, $6, $7, $8::jsonb, $3)`,
      [
        documentId,
        eventType,
        occurredAt,
        actor.subject_id,
        fromVisitId,
        toVisitId,
        reason,
        JSON.stringify(details),
      ],
    );
  }
}
