import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { TruckVisit, VisitEvent, exactlyOneRowUpdated, returnedRows } from '@truck-log/server/data-access';
import { DriverPrintService } from '@truck-log/server/domain/driver-print';
import {
    rxoLoadAvailableSql,
    rxoSelectionSql,
    rxoShipmentLockKey,
    type RxoShipmentIdentity,
} from '@truck-log/server/domain/rxo';

/*
 * RXO steps of guard check-in, run inside the TruckVisitsService.create
 * transaction. Kept together so the exact-tuple rules are reviewed in one place.
 */

/**
 * Lock the exact RXO shipment tuple and prove it exists exactly once, then prove
 * the load is still available. Same-request retries return before this; the
 * shipment lock serializes two guards selecting the same exact RXO identity.
 */
export async function assertRxoShipmentSelectable(
    manager: EntityManager,
    rxoIdentity: RxoShipmentIdentity,
): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        rxoShipmentLockKey(rxoIdentity),
    ]);
    const exactShipments = await manager.query(
        rxoSelectionSql(rxoIdentity.siteKey),
        [rxoIdentity.siteKey, rxoIdentity.shipmentId, rxoIdentity.direction],
    );
    if (exactShipments.length !== 1) {
        throw exactShipments.length === 0
            ? new BadRequestException('The exact RXO site, shipment, and direction selection no longer exists.')
            : new ConflictException('The RXO shipment selection is ambiguous; Truck Log did not guess a visit association.');
    }
    const [availability] = await manager.query(
        `SELECT ${rxoLoadAvailableSql('$1::text', '$2::text', '$3::text')} AS available`,
        [rxoIdentity.siteKey, rxoIdentity.shipmentId, rxoIdentity.direction],
    ) as Array<{ available: boolean }>;
    if (!availability?.available) {
        throw new ConflictException('This RXO load has already been checked in. Refresh the available loads and open its existing visit.');
    }
}

/**
 * Associate the shipment's single active, unassociated RXO driver document with
 * the new visit and request its original print package; record a skip when the
 * active document already belongs to another visit.
 */
export async function associateActiveRxoDocument(
    manager: EntityManager,
    driverPrint: DriverPrintService,
    eventRepository: Repository<VisitEvent>,
    savedVisit: TruckVisit,
    rxoIdentity: RxoShipmentIdentity,
    guardGate: 'EAST' | 'WEST' | null,
    actor: string | null,
    now: Date,
    requestPrinting = true,
): Promise<void> {
    const activeDocuments = await manager.query(
        `SELECT id, truck_visit_id, rxo_document_version, file_name, sha256
           FROM visit_documents
          WHERE rxo_site_key = $1
            AND rxo_shipment_id = $2
            AND rxo_direction = $3
            AND document_type = 'RXO_DRIVER_DOCUMENT'
            AND source_kind = 'MATERIALS_UPLOAD'
            AND rxo_is_active = TRUE
          FOR UPDATE`,
        [rxoIdentity.siteKey, rxoIdentity.shipmentId, rxoIdentity.direction],
    ) as Array<{
        id: number | string;
        truck_visit_id: number | string | null;
        rxo_document_version: number | string;
        file_name: string;
        sha256: string;
    }>;
    if (activeDocuments.length > 1) {
        throw new ConflictException('More than one active RXO driver document exists; Truck Log did not guess which version to print.');
    }
    const activeDocument = activeDocuments[0];
    if (activeDocument && activeDocument.truck_visit_id === null) {
        const associatedBy = actor ?? 'TRUCK_LOG_CHECK_IN';
        const updated = returnedRows(await manager.query(
            `UPDATE visit_documents
                SET truck_visit_id = $2,
                    association_status = 'ASSOCIATED',
                    association_method = 'RXO_EXACT_TUPLE',
                    associated_at = $3,
                    associated_by = $4,
                    association_reason = $5,
                    review_status = 'NOT_APPLICABLE',
                    review_reason = NULL,
                    updated_at = $3
              WHERE id = $1 AND truck_visit_id IS NULL AND rxo_is_active = TRUE
              RETURNING id`,
            [
                activeDocument.id,
                savedVisit.id,
                now,
                associatedBy,
                'Guard selected the exact RXO site, shipment, and direction tuple during check-in.',
            ],
        ));
        if (!exactlyOneRowUpdated(updated, activeDocument.id)) {
            throw new ConflictException('The active RXO document association changed during check-in.');
        }
        await manager.query(
            `INSERT INTO sap_document_events(
               visit_document_id, event_type, occurred_at, actor_type, actor_id,
               from_visit_id, to_visit_id, reason, details, created_at
             ) VALUES ($1, 'RXO_DOCUMENT_ASSOCIATED_TO_VISIT', $2, 'SYSTEM',
               'TRUCK_LOG_CHECK_IN', NULL, $3, $4, $5::jsonb, $2)`,
            [
                activeDocument.id,
                now,
                savedVisit.id,
                'Exact RXO site, shipment, and direction tuple selected during guard check-in.',
                JSON.stringify({
                    siteKey: rxoIdentity.siteKey,
                    shipmentId: rxoIdentity.shipmentId,
                    direction: rxoIdentity.direction,
                    documentVersion: Number(activeDocument.rxo_document_version),
                    sha256: activeDocument.sha256,
                    guardActorLabel: actor,
                }),
            ],
        );
        await eventRepository.save(eventRepository.create({
            truckVisitId: savedVisit.id,
            eventType: 'RXO_DOCUMENT_ASSOCIATED_TO_VISIT',
            occurredAt: now,
            actor: associatedBy,
            notes: `RXO driver document ${activeDocument.id} version ${activeDocument.rxo_document_version} associated by exact RXO tuple.`,
            createdAt: now,
        }));
        if (requestPrinting) await driverPrint.createOriginalPackage(
            manager,
            savedVisit.id,
            Number(activeDocument.id),
            actor,
            guardGate,
        );
    }
    else if (activeDocument && Number(activeDocument.truck_visit_id) !== savedVisit.id) {
        await eventRepository.save(eventRepository.create({
            truckVisitId: savedVisit.id,
            eventType: 'RXO_DOCUMENT_ASSOCIATION_SKIPPED',
            occurredAt: now,
            actor: actor ?? 'TRUCK_LOG_CHECK_IN',
            notes: `RXO driver document ${activeDocument.id} is already associated with another visit; Truck Log did not reassign or print it.`,
            createdAt: now,
        }));
    }
}
