import { EntityManager } from 'typeorm';
import { VisitDocument } from '@truck-log/server/data-access';
import { SapDocumentEvent } from '@truck-log/server/data-access';

/** Caller holds the visit lock and replaces the current row in the same transaction.
 * The one-current-packing-slip index includes every attached PACKING_SLIP row.
 * Preserve the retired PDF/capture and its audit trail without a current visit link.
 */
export async function retirePackingSlip(
  manager: EntityManager, document: VisitDocument, visitId: number, now: Date, reason: string,
): Promise<void> {
  if (document.truckVisitId !== visitId || document.documentType !== 'PACKING_SLIP' || !document.associatedAt) {
    throw new Error('Packing-slip association changed; no document was replaced.');
  }
  document.truckVisitId = null;
  document.associationStatus = 'ORPHANED';
  document.associationMethod = 'REPLACED_IN_VISIT';
  document.associationReason = reason;
  document.isAuthoritative = false;
  document.supersededAt = now;
  document.updatedAt = now;
  await manager.getRepository(VisitDocument).save(document);
  const events = manager.getRepository(SapDocumentEvent);
  await events.save(events.create({
    visitDocumentId: document.id, eventType: 'PACKING_SLIP_SUPERSEDED', occurredAt: now,
    actorType: 'SYSTEM', actorId: null, fromVisitId: visitId, toVisitId: null, reason,
    details: { workflow: 'DOCK_DOCUMENT', retainedFile: true, sha256: document.sha256 }, createdAt: now,
  }));
}
