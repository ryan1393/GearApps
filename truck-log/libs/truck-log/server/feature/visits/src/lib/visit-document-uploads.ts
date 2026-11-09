import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { removeIfUncommitted } from '@truck-log/server/infrastructure/sap-documents';
import { VisitStatuses } from '@truck-log/shared/contracts';
import { TruckVisit } from '@truck-log/server/data-access';
import { VisitDocument } from '@truck-log/server/data-access';
import { VisitEvent } from '@truck-log/server/data-access';
import { SapDocumentEvent } from '@truck-log/server/data-access';
import { retirePackingSlip } from './packing-slip-supersession';
import { PackingSlipPdfService } from './packing-slip-pdf.service';
import { ALLOWED_DOCUMENT_MIME_TYPES, VisitDocumentFileStorage } from './visit-document-file-storage';
import { PACKING_SLIP_DOCUMENT_TYPE, normalizeActor } from './truck-visit.model';
import type { UploadedPaperworkFile } from './truck-visits.service';

/**
 * Legacy visit paperwork uploads: general visit documents and the optional
 * Dock Board packing-slip PDF. A plain class constructed by TruckVisitsService.
 */
export class VisitDocumentUploads {
    constructor(
        private readonly dataSource: DataSource,
        private readonly config: ConfigService,
        private readonly packingSlipPdf: PackingSlipPdfService,
        private readonly files: VisitDocumentFileStorage,
        private readonly getVisit: (visitId: number) => Promise<TruckVisit>,
    ) { }
    async addDocument(visitId: number, file: UploadedPaperworkFile, actor?: string, documentType?: string) {
        if (documentType?.trim().toUpperCase() === 'RXO_DRIVER_DOCUMENT') {
            throw new BadRequestException(
                'RXO driver documents must be uploaded to the exact RXO shipment through the protected Materials workflow.',
            );
        }
        if (!file)
            throw new BadRequestException('No document was uploaded.');
        if (documentType?.trim().toUpperCase() === PACKING_SLIP_DOCUMENT_TYPE) {
            throw new BadRequestException('Packing slips must be uploaded from the Dock Board so the SAP Document/Delivery ID can be verified.');
        }
        const maxMb = Number(this.config.get('TRUCK_LOG_MAX_DOCUMENT_MB') ?? 25);
        const maxBytes = (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 25) * 1024 * 1024;
        if ((file.size ?? file.buffer.length) > maxBytes) {
            throw new BadRequestException(`Document exceeds ${maxMb} MB.`);
        }
        if (file.mimetype && !ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype.toLowerCase())) {
            throw new BadRequestException('Only PDF, JPEG, PNG, TIFF, or BMP paperwork files are allowed.');
        }
        const visit = await this.getVisit(visitId);
        const folder = this.files.ensureVisitFolder(visit.documentFolderKey);
        const { fileName, storedFileName } = this.files.sanitizeDocumentFileName(file.originalname);
        const absolutePath = join(folder, storedFileName);
        writeFileSync(absolutePath, file.buffer);
        const relativePath = [...visit.documentFolderKey.split('/'), storedFileName].join('/');
        const normalizedActor = normalizeActor(actor);
        try {
            return await this.dataSource.transaction(async (manager) => {
                const documentRepository = manager.getRepository(VisitDocument);
                const eventRepository = manager.getRepository(VisitEvent);
                const now = new Date();
                const sha256 = createHash('sha256').update(file.buffer).digest('hex');
                const document = await documentRepository.save(documentRepository.create({
                    truckVisitId: visitId,
                    fileName,
                    storedFileName,
                    relativePath,
                    documentType: documentType?.trim() || null,
                    mimeType: file.mimetype || null,
                    fileSizeBytes: file.size ?? file.buffer.length,
                    pageCount: null,
                    extractedDocumentId: null,
                    extractionStatus: 'NOT_APPLICABLE',
                    extractionMethod: null,
                    extractionMessage: null,
                    scannedAt: now,
                    scannedBy: normalizedActor,
                    createdAt: now,
                    sourceKind: 'VISIT_UPLOAD',
                    sourceAgentId: null,
                    sourceCaptureId: null,
                    sha256,
                    capturedAt: now,
                    printStatus: 'NOT_APPLICABLE',
                    validationStatus: 'NOT_APPLICABLE',
                    reviewStatus: 'NOT_APPLICABLE',
                    associationStatus: 'ASSOCIATED',
                    associationMethod: 'VISIT_CONTEXT',
                    associatedAt: now,
                    associatedBy: normalizedActor,
                    isAuthoritative: false,
                    storageStatus: 'STORED',
                    retentionStatus: 'ACTIVE',
                    updatedAt: now,
                }));
                await eventRepository.save(eventRepository.create({
                    truckVisitId: visitId,
                    eventType: 'DOCUMENT_ADDED',
                    occurredAt: now,
                    actor: normalizedActor,
                    notes: fileName,
                    createdAt: now,
                }));
                return document;
            });
        }
        catch (error) {
            // Keep the file if the commit may have succeeded (see removeIfUncommitted).
            await removeIfUncommitted(this.dataSource, relativePath, () => unlinkSync(absolutePath));
            throw error;
        }
    }
    async addPackingSlip(visitId: number, file: UploadedPaperworkFile, actor?: string) {
        if (!file)
            throw new BadRequestException('No packing-slip PDF was uploaded.');
        const maxMb = Number(this.config.get('TRUCK_LOG_MAX_DOCUMENT_MB') ?? 25);
        const safeMaxMb = Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 25;
        const maxBytes = safeMaxMb * 1024 * 1024;
        if ((file.size ?? file.buffer.length) > maxBytes) {
            throw new BadRequestException(`Packing-slip PDF exceeds ${safeMaxMb} MB.`);
        }
        if (extname(file.originalname || '').toLowerCase() !== '.pdf') {
            throw new BadRequestException('The Dock Board packing slip must be a PDF file.');
        }
        if (file.mimetype && !['application/pdf', 'application/octet-stream'].includes(file.mimetype.toLowerCase())) {
            throw new BadRequestException('The Dock Board packing slip must use the PDF content type.');
        }
        const header = file.buffer.subarray(0, Math.min(file.buffer.length, 1024)).toString('latin1');
        if (!header.includes('%PDF-')) {
            throw new BadRequestException('The selected file has a .pdf name but does not contain a valid PDF header.');
        }
        const visit = await this.getVisit(visitId);
        if (visit.status !== VisitStatuses.DOCK_ASSIGNED) {
            throw new BadRequestException('Packing slips can only be uploaded while the truck is assigned to a dock.');
        }
        const extraction = this.packingSlipPdf.extract(file.buffer);
        const folder = this.files.ensureVisitFolder(visit.documentFolderKey);
        const storedFileName = this.files.packingSlipStoredName(extraction.documentId);
        const fileName = `${extraction.documentId || 'packing-slip-needs-review'}.pdf`;
        const absolutePath = join(folder, storedFileName);
        const relativePath = [...visit.documentFolderKey.split('/'), storedFileName].join('/');
        const normalizedActor = normalizeActor(actor);
        writeFileSync(absolutePath, file.buffer);
        let oldRelativePath: string | null = null;
        try {
            const saved = await this.dataSource.transaction(async (manager) => {
                const visitRepository = manager.getRepository(TruckVisit);
                const documentRepository = manager.getRepository(VisitDocument);
                const eventRepository = manager.getRepository(VisitEvent);
                const sapEventRepository = manager.getRepository(SapDocumentEvent);
                const lockedVisit = await visitRepository.findOne({
                    where: { id: visitId },
                    lock: { mode: 'pessimistic_write' },
                });
                if (!lockedVisit)
                    throw new NotFoundException('Truck visit not found.');
                if (lockedVisit.status !== VisitStatuses.DOCK_ASSIGNED) {
                    throw new BadRequestException('Packing slips can only be uploaded while the truck is assigned to a dock.');
                }
                let existing = await documentRepository.findOne({
                    where: { truckVisitId: visitId, documentType: PACKING_SLIP_DOCUMENT_TYPE },
                    lock: { mode: 'pessimistic_write' },
                });
                const now = new Date();
                const replacedCapture = existing?.sourceKind === 'PRINT_AGENT' ? existing : null;
                if (replacedCapture) {
                    await retirePackingSlip(manager, replacedCapture, visitId, now,
                        'Captured packing slip replaced by explicit optional Dock Board PDF upload.');
                    existing = null; // preserve the original capture row and immutable PDF
                }
                const sha256 = createHash('sha256').update(file.buffer).digest('hex');
                const reviewReason = 'Legacy Dock Board extraction must be revalidated against a Packing List or Packing Slip marker and exactly one 8-digit Delivery Number.';
                oldRelativePath = existing?.relativePath || null;
                const document = existing || documentRepository.create({
                    truckVisitId: visitId,
                    documentType: PACKING_SLIP_DOCUMENT_TYPE,
                    createdAt: now,
                });
                document.fileName = fileName;
                document.originalFileName = this.files.sanitizeDocumentFileName(file.originalname).fileName;
                document.storedFileName = storedFileName;
                document.relativePath = relativePath;
                document.mimeType = 'application/pdf';
                document.fileSizeBytes = file.size ?? file.buffer.length;
                document.pageCount = extraction.pageCount;
                document.extractedDocumentId = extraction.documentId;
                document.extractionStatus = extraction.status;
                document.extractionMethod = extraction.method;
                document.extractionMessage = extraction.message;
                document.scannedAt = now;
                document.scannedBy = normalizedActor;
                document.sapDocumentTypeCode = PACKING_SLIP_DOCUMENT_TYPE;
                document.sourceKind = 'VISIT_UPLOAD';
                document.sourceAgentId = null;
                document.sourceCaptureId = null;
                document.sha256 = sha256;
                document.capturedAt = now;
                document.route = null;
                document.sourceQueue = null;
                document.outputPrinter = null;
                document.printStatus = 'NOT_APPLICABLE';
                document.printError = null;
                document.reportedDocumentId = extraction.documentId;
                document.validationStatus = 'REVIEW_REQUIRED';
                document.validationRuleVersion = 'LEGACY_PRE_STRICT_V1';
                document.confidence = null;
                document.reviewStatus = 'NEEDS_REVIEW';
                document.reviewReason = reviewReason;
                document.associationStatus = 'ASSOCIATED';
                document.associationMethod = 'VISIT_CONTEXT';
                document.associatedAt = existing?.associatedAt || now;
                document.associatedBy = existing?.associatedBy || normalizedActor;
                document.associationReason = 'Manual Dock Board upload to the selected Truck Log visit.';
                document.isAuthoritative = true;
                document.supersedesDocumentId = replacedCapture?.id ?? existing?.supersedesDocumentId ?? null;
                document.supersededAt = null;
                document.storageStatus = 'STORED';
                document.retentionStatus = 'ACTIVE';
                document.updatedAt = now;
                const savedDocument = await documentRepository.save(document);
                await sapEventRepository.save(sapEventRepository.create({
                    visitDocumentId: savedDocument.id,
                    eventType: (existing || replacedCapture) ? 'LEGACY_PACKING_SLIP_REPLACED' : 'LEGACY_PACKING_SLIP_UPLOADED',
                    occurredAt: now,
                    actorType: normalizedActor ? 'HUMAN' : 'SYSTEM',
                    actorId: normalizedActor,
                    fromVisitId: (existing || replacedCapture) ? visitId : null,
                    toVisitId: visitId,
                    reason: reviewReason,
                    details: {
                        documentType: PACKING_SLIP_DOCUMENT_TYPE,
                        reportedDocumentId: extraction.documentId,
                        extractionStatus: extraction.status,
                        extractionMethod: extraction.method,
                        validationStatus: 'REVIEW_REQUIRED',
                        reviewStatus: 'NEEDS_REVIEW',
                        sha256,
                        fileName,
                    },
                    createdAt: now,
                }));
                await eventRepository.save(eventRepository.create({
                    truckVisitId: visitId,
                    eventType: (existing || replacedCapture) ? 'PACKING_SLIP_REPLACED' : 'PACKING_SLIP_UPLOADED',
                    occurredAt: now,
                    actor: normalizedActor,
                    notes: extraction.documentId
                        ? `SAP Document/Delivery ID ${extraction.documentId}; ${fileName}`
                        : extraction.message,
                    createdAt: now,
                }));
                return savedDocument;
            });
            if (oldRelativePath && oldRelativePath !== relativePath) {
                try {
                    unlinkSync(this.files.resolveStoragePath(oldRelativePath));
                }
                catch {
                    // Best-effort cleanup. The replacement record points only to the new PDF.
                }
            }
            saved.fileAvailable = true;
            return saved;
        }
        catch (error) {
            // Keep the file if the commit may have succeeded (see removeIfUncommitted).
            await removeIfUncommitted(this.dataSource, relativePath, () => unlinkSync(absolutePath));
            throw error;
        }
    }
}
