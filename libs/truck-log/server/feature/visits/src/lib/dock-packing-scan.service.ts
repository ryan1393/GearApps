import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { workflowSigningKey } from './workflow-signing-key';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { VisitStatuses, type DockScanLookup, type DockDeliveryScanReceipt } from '@truck-log/shared/contracts';
import { TruckVisit } from '@truck-log/server/data-access';
import { VisitDocument } from '@truck-log/server/data-access';
import { VisitEvent } from '@truck-log/server/data-access';
import { SapDocumentEvent } from '@truck-log/server/data-access';
import { readDockScanPdf } from './dock-scan-document-storage';
import { retirePackingSlip } from './packing-slip-supersession';
import { DELIVERY_SCAN_EVENT, DELIVERY_MANUAL_EVENT, deliveryScanNote, deliveryManualNote } from './visit-delivery-scans';

interface ScanProof {
  v: 17;
  kind: 'selected' | 'previewed';
  visitId: number;
  documentId: number;
  deliveryNumber: string;
  sha256: string;
  fingerprint: string;
  previousId: number | null;
  previousFingerprint: string | null;
  expires: number;
}

/** Uses the existing trusted-internal visits boundary, not Print Agent credentials.
 * A scan timing check is a browser workflow rule, never an authentication claim.
 * HMAC proofs bind a preview/confirmation to the exact visit and document revision.
 */
@Injectable()
export class DockPackingScanService {
  private readonly proofKey = workflowSigningKey('dock-packing-scan');
  constructor(private readonly dataSource: DataSource, private readonly config: ConfigService) {}

  private fingerprint(doc: VisitDocument | null): string | null {
    if (!doc) return null;
    return createHash('sha256').update(JSON.stringify([
      doc.id, doc.truckVisitId, doc.documentType, doc.sapDocumentTypeCode, doc.sourceKind,
      doc.extractedDocumentId, doc.reportedDocumentId, doc.extractionStatus, doc.validationStatus,
      doc.validationRuleVersion, doc.reviewStatus, doc.storageStatus, doc.retentionStatus,
      doc.sha256, doc.fileSizeBytes, doc.relativePath, doc.associationStatus, doc.associationMethod,
      doc.isAuthoritative, doc.supersedesDocumentId, doc.supersededAt, doc.updatedAt,
    ])).digest('hex');
  }
  private sign(proof: ScanProof): string {
    const text = Buffer.from(JSON.stringify(proof)).toString('base64url');
    return text + '.' + createHmac('sha256', this.proofKey).update(text).digest('hex');
  }
  private verify(token: string, visitId: number, kind: ScanProof['kind']): ScanProof {
    if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)) {
      throw new BadRequestException('Scan selection is invalid. Scan again.');
    }
    const [body, signature] = token.split('.');
    const expected = createHmac('sha256', this.proofKey).update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new ConflictException('Scan selection expired or changed. Scan again.');
    let proof: ScanProof;
    try { proof = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
    catch { throw new BadRequestException('Scan selection is invalid. Scan again.'); }
    if (proof.v !== 17 || proof.kind !== kind || proof.visitId !== visitId ||
        !Number.isSafeInteger(proof.documentId) || proof.documentId <= 0 ||
        !Number.isSafeInteger(proof.expires) || proof.expires <= Date.now()) {
      throw new ConflictException('Scan selection expired or does not belong to this visit. Scan again.');
    }
    return proof;
  }
  private async activeVisit(manager: EntityManager, visitId: number, lock = false): Promise<TruckVisit> {
    const visit = await manager.getRepository(TruckVisit).findOne({
      where: { id: visitId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!visit) throw new NotFoundException('Truck visit not found.');
    if (visit.status !== VisitStatuses.DOCK_ASSIGNED) {
      throw new ConflictException('This truck is no longer assigned to a dock. Refresh the visit before scanning or attaching paperwork.');
    }
    return visit;
  }
  private current(manager: EntityManager, visitId: number, lock = false): Promise<VisitDocument | null> {
    return manager.getRepository(VisitDocument).findOne({
      where: { truckVisitId: visitId, documentType: 'PACKING_SLIP' },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }
  private eligible(doc: VisitDocument, visitId: number, deliveryNumber: string): boolean {
    if (doc.documentType !== 'PACKING_SLIP' || doc.sapDocumentTypeCode !== 'PACKING_SLIP' ||
        doc.extractedDocumentId !== deliveryNumber || doc.extractionStatus !== 'DETECTED' ||
        doc.mimeType !== 'application/pdf' || doc.storageStatus !== 'STORED' ||
        doc.validationStatus === 'REJECTED' || doc.reviewStatus === 'DISMISSED' ||
        !['ACTIVE', 'HOLD'].includes(doc.retentionStatus) || doc.supersededAt ||
        !/^[a-f0-9]{64}$/.test(doc.sha256 || '')) return false;
    // A current visit-upload is inspectable, but its legacy review state is NOT promoted.
    if (doc.truckVisitId === visitId && doc.associationStatus === 'ASSOCIATED') {
      return doc.sourceKind === 'VISIT_UPLOAD' ||
        (doc.sourceKind === 'PRINT_AGENT' && doc.validationStatus === 'VALIDATED');
    }
    return doc.truckVisitId === null && doc.associationStatus === 'UNMATCHED' &&
      doc.sourceKind === 'PRINT_AGENT' && doc.validationStatus === 'VALIDATED' &&
      doc.validationRuleVersion === 'PACKING_SLIP_V1' && doc.reportedDocumentId === deliveryNumber &&
      !doc.isAuthoritative && doc.associatedAt === null && doc.supersedesDocumentId === null;
  }
  private async pdf(doc: VisitDocument): Promise<Buffer> {
    const configuredMb = Number(this.config.get('TRUCK_LOG_MAX_DOCUMENT_MB') ?? 25);
    const maxBytes = Math.floor((Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 25) * 1024 * 1024);
    try {
      return await readDockScanPdf(this.config.get<string>('TRUCK_LOG_DOCUMENT_STORAGE_ROOT') || './data/documents',
        doc.relativePath, doc.fileSizeBytes || 0, doc.sha256 || '', maxBytes);
    } catch {
      throw new ConflictException('This PDF is missing, changed, or unavailable. Upload a PDF or continue without it; checkout is not blocked.');
    }
  }
  /** Commit the scan BEFORE the optional lookup. PDF failures cannot roll this back.
   * All writers take the same visit lock used by Dock Complete and PDF attachment.
   * Repeated scans of the same number on the same visit are idempotent; distinct
   * numbers are retained rather than silently replacing an earlier scan.
   */
  async recordDeliveryNumber(visitId: number, deliveryNumber: string,
      entryMethod: 'SCAN' | 'MANUAL' = 'SCAN'): Promise<DockDeliveryScanReceipt> {
    if (typeof deliveryNumber !== 'string' || deliveryNumber.length !== 8 || !/^[0-9]{8}$/.test(deliveryNumber)) {
      throw new BadRequestException('Scan or enter exactly the eight-digit SAP Delivery Number.');
    }
    if (entryMethod !== 'SCAN' && entryMethod !== 'MANUAL') throw new BadRequestException('Invalid delivery entry method.');
    return this.dataSource.transaction<DockDeliveryScanReceipt>(async (manager) => {
      const visit = await this.activeVisit(manager, visitId, true);
      const events = manager.getRepository(VisitEvent);
      const notes = entryMethod === 'MANUAL' ? deliveryManualNote(deliveryNumber) : deliveryScanNote(deliveryNumber);
      // Deduplicate across BOTH modes while preserving the original event and origin.
      const previous = await events.findOne({
        where: [
          { truckVisitId: visitId, eventType: DELIVERY_SCAN_EVENT, notes: deliveryScanNote(deliveryNumber) },
          { truckVisitId: visitId, eventType: DELIVERY_MANUAL_EVENT, notes: deliveryManualNote(deliveryNumber) },
        ], order: { id: 'ASC' },
      });
      if (previous) return { visitId, deliveryNumber, eventId: previous.id,
        savedAt: previous.occurredAt.toISOString(), alreadySaved: true,
        entryMethod: previous.eventType === DELIVERY_MANUAL_EVENT ? 'MANUAL' : 'SCAN' };
      const now = new Date();
      const saved = await events.save(events.create({ truckVisitId: visitId,
        eventType: entryMethod === 'MANUAL' ? DELIVERY_MANUAL_EVENT : DELIVERY_SCAN_EVENT, notes, actor: null, occurredAt: now, createdAt: now }));
      visit.updatedAt = now;
      await manager.getRepository(TruckVisit).save(visit);
      return { visitId, deliveryNumber, eventId: saved.id, savedAt: saved.occurredAt.toISOString(), alreadySaved: false, entryMethod };
    });
  }
  async lookup(visitId: number, deliveryNumber: string): Promise<DockScanLookup> {
    if (typeof deliveryNumber !== 'string' || !/^[0-9]{8}$/.test(deliveryNumber)) {
      throw new BadRequestException('Scan exactly the eight-digit SAP Delivery Number.');
    }
    const manager = this.dataSource.manager;
    await this.activeVisit(manager, visitId);
    const previous = await this.current(manager, visitId);
    const common = { documentType: 'PACKING_SLIP', extractedDocumentId: deliveryNumber, storageStatus: 'STORED' };
    const matches = await manager.getRepository(VisitDocument).find({ where: [
      { ...common, truckVisitId: IsNull(), associationStatus: 'UNMATCHED', sourceKind: 'PRINT_AGENT', validationStatus: 'VALIDATED' },
      { ...common, truckVisitId: visitId, associationStatus: 'ASSOCIATED' },
    ], order: { capturedAt: 'DESC', id: 'DESC' }, take: 21 });
    if (matches.length > 20) throw new ConflictException('Too many captures share this number. Have the document captures reviewed, or use optional upload.');
    const candidates: DockScanLookup['candidates'] = [];
    for (const doc of matches) {
      if (!this.eligible(doc, visitId, deliveryNumber)) continue;
      try { await this.pdf(doc); } catch { continue; }
      const proof: ScanProof = { v: 17, kind: 'selected', visitId, documentId: doc.id, deliveryNumber,
        sha256: doc.sha256!, fingerprint: this.fingerprint(doc)!, previousId: previous?.id ?? null,
        previousFingerprint: this.fingerprint(previous), expires: Date.now() + 5 * 60 * 1000 };
      candidates.push({ documentId: doc.id, deliveryNumber, fileName: doc.originalFileName || doc.fileName,
        fileSizeBytes: doc.fileSizeBytes!, capturedAt: doc.capturedAt.toISOString(), sha256: doc.sha256!,
        alreadyAttached: doc.truckVisitId === visitId, selectionToken: this.sign(proof) });
    }
    return { visitId, deliveryNumber,
      currentDocument: previous ? { id: previous.id, fileName: previous.originalFileName || previous.fileName,
        deliveryNumber: previous.extractedDocumentId } : null, candidates,
      message: candidates.length ? 'Open the correct PDF, then confirm its attachment to this visit.' :
        'No available matching PDF found. Upload is optional. Dock Complete and checkout are allowed without it. PDFs attached to another visit are never moved.',
    };
  }
  async preview(visitId: number, token: string): Promise<{ buffer: Buffer; previewToken: string }> {
    const proof = this.verify(token, visitId, 'selected');
    const manager = this.dataSource.manager;
    await this.activeVisit(manager, visitId);
    const doc = await manager.getRepository(VisitDocument).findOne({ where: { id: proof.documentId } });
    const previous = await this.current(manager, visitId);
    if (!doc || !this.eligible(doc, visitId, proof.deliveryNumber) || this.fingerprint(doc) !== proof.fingerprint ||
        (previous?.id ?? null) !== proof.previousId || this.fingerprint(previous) !== proof.previousFingerprint) {
      throw new ConflictException('The document or current attachment changed. Scan again before attaching.');
    }
    const buffer = await this.pdf(doc);
    return { buffer, previewToken: this.sign({ ...proof, kind: 'previewed' }) };
  }
  async attach(visitId: number, token: string): Promise<VisitDocument> {
    const proof = this.verify(token, visitId, 'previewed');
    return this.dataSource.transaction(async (manager) => {
      const visit = await this.activeVisit(manager, visitId, true);
      const documents = manager.getRepository(VisitDocument);
      const previous = await this.current(manager, visitId, true);
      const doc = await documents.findOne({ where: { id: proof.documentId }, lock: { mode: 'pessimistic_write' } });
      if (!doc || !this.eligible(doc, visitId, proof.deliveryNumber) || doc.sha256 !== proof.sha256) {
        throw new ConflictException('That PDF is no longer available for this visit. Nothing was moved. Scan again.');
      }
      // Repeated confirmation of the same attached revision is idempotent.
      if (previous?.id === doc.id && doc.truckVisitId === visitId &&
          (this.fingerprint(doc) === proof.fingerprint || doc.associationMethod === 'DOCK_SCAN_CONFIRM')) {
        await this.pdf(doc); doc.fileAvailable = true; return doc;
      }
      if (this.fingerprint(doc) !== proof.fingerprint || (previous?.id ?? null) !== proof.previousId ||
          this.fingerprint(previous) !== proof.previousFingerprint) {
        throw new ConflictException('The document or current packing slip changed after preview. Scan again.');
      }
      await this.pdf(doc);
      const now = new Date();
      if (previous) await retirePackingSlip(manager, previous, visitId, now, 'Replaced after explicit Delivery Number PDF preview and confirmation.');
      doc.truckVisitId = visitId;
      doc.associationStatus = 'ASSOCIATED';
      doc.associationMethod = 'DOCK_SCAN_CONFIRM';
      doc.associatedAt = now;
      doc.associatedBy = null; // Existing visits UI is not an authenticated named-human principal.
      doc.associationReason = 'Operator confirmed the Delivery Number and PDF against the selected dock visit.';
      doc.isAuthoritative = true;
      doc.supersedesDocumentId = previous?.id ?? null;
      doc.reviewStatus = 'RESOLVED'; // Only VALIDATED, previously UNMATCHED Print Agent records reach this branch.
      doc.reviewReason = null;
      doc.updatedAt = now;
      await documents.save(doc);
      const sapEvents = manager.getRepository(SapDocumentEvent);
      await sapEvents.save(sapEvents.create({ visitDocumentId: doc.id, eventType: 'DOCK_DOCUMENT_ATTACHED',
        occurredAt: now, actorType: 'SYSTEM', actorId: null, fromVisitId: null, toVisitId: visitId,
        reason: doc.associationReason, details: { workflow: 'DOCK_DELIVERY_CONFIRM', deliveryNumber: proof.deliveryNumber,
          sha256: doc.sha256, replacedDocumentId: previous?.id ?? null, previewConfirmed: true }, createdAt: now }));
      const events = manager.getRepository(VisitEvent);
      await events.save(events.create({ truckVisitId: visitId, eventType: 'PACKING_SLIP_CONFIRMED', occurredAt: now,
        actor: null, notes: `Delivery Number ${proof.deliveryNumber}; PDF ${doc.id} reviewed, confirmed and attached.`, createdAt: now }));
      visit.updatedAt = now;
      await manager.getRepository(TruckVisit).save(visit);
      doc.fileAvailable = true;
      return doc;
    });
  }
}
