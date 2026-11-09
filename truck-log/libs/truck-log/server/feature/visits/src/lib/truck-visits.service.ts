import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createReadStream, existsSync, rmSync } from 'node:fs';
import { DataSource, Repository } from 'typeorm';
import { workflowSigningKey } from './workflow-signing-key';
import { TruckDirections, VisitStatuses } from '@truck-log/shared/contracts';
import { CreateTruckVisitDto } from './dto/create-truck-visit.dto';
import { TruckVisit } from '@truck-log/server/data-access';
import { VisitDocument } from '@truck-log/server/data-access';
import { VisitEvent } from '@truck-log/server/data-access';
import { Dock } from '@truck-log/server/data-access';
import { scannedDeliveryNumbers } from './visit-delivery-scans';
import { PackingSlipPdfService } from './packing-slip-pdf.service';
import { CheckoutPrintProof } from './checkout-print-proof';
import { PackingSlipExtractionStatuses } from './packing-slip-pdf-extractor';
import { DriverPrintService } from '@truck-log/server/domain/driver-print';
import { scheduledLoadAvailableSql } from '@truck-log/server/domain/rxo';
import { renderTruckVisitSlipHtml } from './truck-visit-slip.renderer';
import {
    PACKING_SLIP_DOCUMENT_TYPE,
    assertIdempotentVisitMatches,
    makeFolderKey,
    makeVisitNumber,
    normalizeActor,
    normalizeDriverPhone,
    normalizeRxoIdentity,
    type NormalizedVisitCreate,
} from './truck-visit.model';
import { upsertCarrierReference, upsertDriverReference, upsertLocationPair } from './visit-reference-upserts';
import { assertRxoShipmentSelectable, associateActiveRxoDocument } from './visit-rxo-association';
import { VisitDocumentFileStorage } from './visit-document-file-storage';
import { VisitDocumentUploads } from './visit-document-uploads';
import { TruckVisitQueries } from './truck-visit.queries';
export interface UploadedPaperworkFile {
    originalname: string;
    mimetype?: string;
    size?: number;
    buffer: Buffer;
}

/**
 * Transactional coordinator for the Truck Log visit lifecycle.
 *
 * Keep workflow invariants, row locking, audit writes, and visit persistence
 * here. Presentation belongs in renderers, document parsing belongs in the
 * packing-slip helpers, and RXO acquisition/query behavior belongs in the RXO
 * modules. That boundary keeps this service focused on state transitions.
 * Read-only lists live in truck-visit.queries, legacy paperwork uploads in
 * visit-document-uploads, and the RXO check-in steps in visit-rxo-association.
 */
@Injectable()
export class TruckVisitsService {
    private readonly checkoutPrintProof = new CheckoutPrintProof(workflowSigningKey('checkout-print-proof'));
    private readonly files: VisitDocumentFileStorage;
    private readonly queries: TruckVisitQueries;
    private readonly uploads: VisitDocumentUploads;
    constructor(
    @InjectRepository(TruckVisit)
    private readonly visits: Repository<TruckVisit>, 
    @InjectRepository(VisitDocument)
    private readonly documents: Repository<VisitDocument>, 
    @InjectRepository(VisitEvent)
    private readonly events: Repository<VisitEvent>, 
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly packingSlipPdf: PackingSlipPdfService,
    private readonly driverPrint: DriverPrintService) {
        this.files = new VisitDocumentFileStorage(this.config);
        this.queries = new TruckVisitQueries(this.visits, this.events, this.files, () => this.timeZone());
        this.uploads = new VisitDocumentUploads(
            this.dataSource,
            this.config,
            this.packingSlipPdf,
            this.files,
            (visitId) => this.get(visitId),
        );
    }
    private timeZone() {
        return this.config.get<string>('TZ')?.trim() || 'UTC';
    }
    private async plantLocationName() {
        const rows = await this.dataSource.query(`SELECT value FROM app_settings WHERE key = 'plant_location_name' LIMIT 1`) as Array<{
            value?: string | null;
        }>;
        return rows[0]?.value?.trim() || 'Fort Wayne';
    }
    async checkInConfig() {
        const routing = await this.driverPrint.getGateRoutingStatus();
        const ready = routing.configurationValid && routing.gates.some(gate => gate.available);
        return { automaticDriverPrinting: ready,
            printingUnavailableReason: ready ? undefined : 'Automatic printing is unavailable. Save the visit and print manually in the browser.',
            plantLocationName: await this.plantLocationName() };
    }
    async create(dto: CreateTruckVisitDto) {
        if (dto.autoPrintDockSlip === true && (!dto.clientRequestId || !['EAST','WEST'].includes(String(dto.guardGate)))) {
            throw new BadRequestException('Automatic check-in printing requires the original request ID and the saved East/West workstation gate.');
        }

        const now = new Date();
        const visitNumber = makeVisitNumber(now);
        const loadNumber = dto.loadNumber.trim().toUpperCase();
        const carrierName = dto.carrierName.trim();
        const driverName = dto.driverName.trim();
        const driverPhone = normalizeDriverPhone(dto.driverPhone);
        const tractorId = dto.tractorId.trim().toUpperCase();
        const trailerId = dto.trailerId.trim().toUpperCase();
        const submittedOriginName = dto.originName.trim();
        const submittedDestinationName = dto.destinationName.trim();
        const dockCode = dto.dockCode.trim().toUpperCase();
        const actor = normalizeActor(dto.actor);
        const plantLocationName = await this.plantLocationName();
        const originName = dto.direction === TruckDirections.OUTBOUND
            ? plantLocationName
            : submittedOriginName;
        const destinationName = dto.direction === TruckDirections.INBOUND
            ? plantLocationName
            : submittedDestinationName;
        if (!loadNumber)
            throw new BadRequestException('Load Number is required.');
        if (!carrierName)
            throw new BadRequestException('Carrier is required.');
        if (!driverName)
            throw new BadRequestException('Driver name is required.');
        if (!tractorId)
            throw new BadRequestException('Tractor ID is required.');
        if (!trailerId)
            throw new BadRequestException('Trailer ID is required.');
        if (!originName)
            throw new BadRequestException('Origin is required for inbound loads.');
        if (!destinationName)
            throw new BadRequestException('Destination is required for outbound loads.');
        if (!dockCode)
            throw new BadRequestException('Dock assignment is required.');

        const input: NormalizedVisitCreate = {
            loadNumber,
            direction: dto.direction,
            carrierName,
            driverName,
            driverPhone,
            tractorId,
            trailerId,
            isDropTrailer: dto.isDropTrailer,
            originName,
            destinationName,
            dockCode,
            notes: dto.notes?.trim() || null,
            actor,
            rxoIdentity: normalizeRxoIdentity(dto, loadNumber),
            clientRequestId: dto.clientRequestId ?? null,
            guardGate: dto.guardGate ?? null,
            manualPrinting: dto.autoPrintDockSlip === false,
        };
        if (input.rxoIdentity && dto.autoPrintDockSlip !== false && !input.guardGate) throw new BadRequestException('East or West guard gate is required for RXO paperwork.');
        if (input.rxoIdentity && !input.clientRequestId) {
            throw new BadRequestException('clientRequestId is required for an RXO shipment check-in.');
        }
        let documentFolder: string | null = null;
        let visit: TruckVisit;
        try {
            visit = await this.dataSource.transaction(async (manager) => {
                const visitRepository = manager.getRepository(TruckVisit);
                const eventRepository = manager.getRepository(VisitEvent);
                if (input.clientRequestId) {
                    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
                        `truck-log:visit-create:${input.clientRequestId}`,
                    ]);
                    const existing = await visitRepository.findOne({
                        where: { clientRequestId: input.clientRequestId },
                    });
                    if (existing) {
                        assertIdempotentVisitMatches(existing, input);
                        await this.driverPrint.assertAutomaticPrintRequest(manager, existing.id, dto.autoPrintDockSlip === true, input.guardGate);
                        return existing;
                    }
                }

                if (input.rxoIdentity) {
                    await assertRxoShipmentSelectable(manager, input.rxoIdentity);
                }

                const dock = await manager.getRepository(Dock).createQueryBuilder('dock')
                    .where('UPPER(dock.code) = :code', { code: dockCode })
                    .andWhere('dock.active = true')
                    .getOne();
                if (!dock) {
                    throw new BadRequestException(`Dock ${dockCode} is not an active configured dock.`);
                }
                // scheduled_at remains server-owned and is populated only from an
                // active exact load-number match.
                const scheduledRows = await manager.query(
                    `SELECT scheduled_at
                       FROM scheduled_loads
                      WHERE UPPER(load_number) = $1 AND active = TRUE
                        AND ${scheduledLoadAvailableSql('scheduled_loads.load_number', 'scheduled_loads.source')}
                      ORDER BY scheduled_at ASC
                      LIMIT 1`,
                    [loadNumber],
                ) as Array<{ scheduled_at: Date }>;

                const documentFolderKey = makeFolderKey(visitNumber, now);
                documentFolder = this.files.ensureVisitFolder(documentFolderKey);
                // Reusable reference records are independent. In particular, a driver is
                // not permanently bound to a carrier; the relationship belongs to this visit.
                const driverId = await upsertDriverReference(manager, driverName, driverPhone, now);
                const carrierId = await upsertCarrierReference(manager, carrierName, now);
                const [originLocationId, destinationLocationId] = await upsertLocationPair(manager, originName, destinationName, now);
                const savedVisit = await visitRepository.save(visitRepository.create({
                    visitNumber,
                    loadNumber,
                    direction: dto.direction,
                    carrierId,
                    carrierName,
                    driverId,
                    driverName,
                    driverPhone,
                    tractorId,
                    trailerId,
                    isDropTrailer: dto.isDropTrailer,
                    originLocationId,
                    originName,
                    destinationLocationId,
                    destinationName,
                    dockCode,
                    notes: input.notes,
                    status: VisitStatuses.DOCK_ASSIGNED,
                    documentFolderKey,
                    scheduledAt: scheduledRows[0]?.scheduled_at ?? null,
                    rxoSiteKey: input.rxoIdentity?.siteKey ?? null,
                    rxoShipmentId: input.rxoIdentity?.shipmentId ?? null,
                    rxoDirection: input.rxoIdentity?.direction ?? null,
                    clientRequestId: input.clientRequestId,
                    manualPrinting: dto.autoPrintDockSlip === false,
                    guardCheckInAt: now,
                    dockAssignedAt: now,
                    dockCompletedAt: null,
                    guardCheckOutAt: null,
                    createdBy: actor,
                    updatedBy: actor,
                    createdAt: now,
                    updatedAt: now,
                }));
                if (dto.autoPrintDockSlip === true) {
                    await this.driverPrint.createAutomaticDockPackage(manager, savedVisit.id, dto.guardGate!, actor);
                }
                await eventRepository.save([
                    eventRepository.create({
                        truckVisitId: savedVisit.id,
                        eventType: 'GUARD_CHECK_IN',
                        occurredAt: now,
                        actor,
                        notes: null,
                        createdAt: now,
                    }),
                    eventRepository.create({
                        truckVisitId: savedVisit.id,
                        eventType: 'DOCK_ASSIGNED',
                        occurredAt: now,
                        actor,
                        notes: `Dock ${dockCode}`,
                        createdAt: now,
                    }),
                ]);

                if (input.rxoIdentity) {
                    await associateActiveRxoDocument(
                        manager,
                        this.driverPrint,
                        eventRepository,
                        savedVisit,
                        input.rxoIdentity,
                        input.guardGate,
                        actor,
                        now,
                        dto.autoPrintDockSlip !== false,
                    );
                }
                return savedVisit;
            });
        }
        catch (error) {
            if (documentFolder) {
                try {
                    rmSync(documentFolder, { recursive: true, force: true });
                }
                catch {
                    // Best-effort cleanup if the visit transaction fails after folder creation.
                }
            }
            throw error;
        }
        const response = await this.driverPrint.attachPackageSummary(visit);
        // clientRequestId doubles as the RXO guard-action capability. The
        // browser already owns it; never echo or expose it from visit APIs.
        response.clientRequestId = null;
        return response;
    }
    async get(id: number) {
        const visit = await this.visits.findOne({
            where: { id },
            relations: { documents: true, events: true },
        });
        if (!visit)
            throw new NotFoundException('Truck visit not found.');
        visit.documents = [...(visit.documents || [])]
            .sort((left, right) => right.scannedAt.getTime() - left.scannedAt.getTime());
        for (const document of visit.documents) {
            if (document.documentType === PACKING_SLIP_DOCUMENT_TYPE) document.fileAvailable = this.files.packingSlipFileAvailable(document);
            if (document.sourceKind === 'MATERIALS_UPLOAD') {
                // RXO binaries are opened only through the scoped download
                // endpoint. Do not disclose persistent storage paths or the
                // uploader credential key through the legacy visit response.
                document.storedFileName = '';
                document.relativePath = '';
                document.uploadedByKeyId = null;
            }
        }
        visit.events = [...(visit.events || [])]
            .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
        visit.scannedDeliveryNumbers = scannedDeliveryNumbers(visit.id, visit.events);
        return this.driverPrint.attachPackageSummary(visit);
    }
    async listOpen(q?: string) {
        return this.queries.listOpen(q);
    }
    async history(q?: string, status = 'ALL', date?: string, limit = 100) {
        return this.queries.history(q, status, date, limit);
    }
    async dashboard() {
        return this.queries.dashboard();
    }
    async dockBoard() {
        return this.queries.dockBoard();
    }
    async addDocument(visitId: number, file: UploadedPaperworkFile, actor?: string, documentType?: string) {
        return this.uploads.addDocument(visitId, file, actor, documentType);
    }
    async addPackingSlip(visitId: number, file: UploadedPaperworkFile, actor?: string) {
        return this.uploads.addPackingSlip(visitId, file, actor);
    }
    async markDockComplete(id: number, actor?: string) {
        return this.dataSource.transaction(async (manager) => {
            const visitRepository = manager.getRepository(TruckVisit);
            const eventRepository = manager.getRepository(VisitEvent);
            const visit = await visitRepository.findOne({
                where: { id },
                lock: { mode: 'pessimistic_write' },
            });
            if (!visit)
                throw new NotFoundException('Truck visit not found.');
            if (visit.status !== VisitStatuses.DOCK_ASSIGNED) {
                throw new BadRequestException('Only a truck assigned to a dock can be marked dock complete.');
            }
            const packingSlip = await manager.getRepository(VisitDocument).findOne({
                where: { truckVisitId: id, documentType: PACKING_SLIP_DOCUMENT_TYPE },
            });
            // document absence is a recorded warning, never a dock-lifecycle blocker.
            const packingSlipAudit = !packingSlip ? 'No packing-slip PDF attached; completion allowed' :
                !this.files.packingSlipFileAvailable(packingSlip) ? 'Packing-slip record exists but PDF is unavailable; completion allowed' :
                packingSlip.extractionStatus === PackingSlipExtractionStatuses.DETECTED && packingSlip.extractedDocumentId
                    ? `SAP Document/Delivery ID ${packingSlip.extractedDocumentId}`
                    : 'Packing slip attached; SAP Document/Delivery ID pending review';
            const now = new Date();
            const normalizedActor = normalizeActor(actor);
            visit.status = VisitStatuses.DOCK_COMPLETE;
            visit.dockCompletedAt = now;
            visit.updatedAt = now;
            visit.updatedBy = normalizedActor || visit.updatedBy;
            const saved = await visitRepository.save(visit);
            await eventRepository.save(eventRepository.create({
                truckVisitId: id,
                eventType: 'DOCK_COMPLETE',
                occurredAt: now,
                actor: normalizedActor,
                notes: `Departed dock ${visit.dockCode}; ${packingSlipAudit}`,
                createdAt: now,
            }));
            return saved;
        });
    }
    async finalCheckout(id: number, actor?: string, printProof?: string) {
        return this.dataSource.transaction(async (manager) => {
            const visitRepository = manager.getRepository(TruckVisit);
            const eventRepository = manager.getRepository(VisitEvent);
            const visit = await visitRepository.findOne({
                where: { id },
                lock: { mode: 'pessimistic_write' },
            });
            if (!visit)
                throw new NotFoundException('Truck visit not found.');
            if (visit.status !== VisitStatuses.DOCK_COMPLETE) {
                throw new BadRequestException('Final guard checkout requires dock completion first.');
            }
            const now = new Date();
            const normalizedActor = normalizeActor(actor);
            const packingSlip = await manager.getRepository(VisitDocument).findOne({
                where: { truckVisitId: id, documentType: PACKING_SLIP_DOCUMENT_TYPE },
            });
            // Enforce the existing guard-screen print step on the server as well.
            // A browser boolean is not evidence: validate a short-lived receipt
            // issued for the exact PDF when its bytes were offered for download.
            const availablePdf = this.files.packingSlipFileAvailable(packingSlip);
            if (availablePdf && !this.checkoutPrintProof.verify(printProof, packingSlip!)) {
                throw new BadRequestException('Open the available packing-slip PDF for printing before final checkout. Reopen it if the confirmation expired.');
            }
            const checkoutDocumentNote = availablePdf
                ? `Packing-slip PDF #${packingSlip!.id} opened for printing; server receipt validated (physical printing not verified).`
                : 'Final checkout allowed without an available packing-slip PDF.';
            visit.status = VisitStatuses.GUARD_CHECKED_OUT;
            visit.guardCheckOutAt = now;
            visit.updatedAt = now;
            visit.updatedBy = normalizedActor || visit.updatedBy;
            const saved = await visitRepository.save(visit);
            await eventRepository.save(eventRepository.create({
                truckVisitId: id,
                eventType: 'FINAL_GUARD_CHECKOUT',
                occurredAt: now,
                actor: normalizedActor,
                notes: checkoutDocumentNote,
                createdAt: now,
            }));
            return saved;
        });
    }
    async documentFile(documentId: number) {
        const document = await this.documents.findOne({ where: { id: documentId } });
        if (!document)
            throw new NotFoundException('Document not found.');
        // Materials-uploaded RXO paperwork has a separate scoped download
        // endpoint. Never expose it through the legacy enumerable visit-file
        // route, which predates human authorization.
        if (document.sourceKind === 'MATERIALS_UPLOAD') {
            throw new NotFoundException('Document not found.');
        }
        const absolute = this.files.resolveStoragePath(document.relativePath);
        if (!existsSync(absolute)) {
            throw new NotFoundException('Document file is missing from storage.');
        }
        // No acknowledgement for unrelated documents, earlier dock stages or
        // already checked-out visits. One PDF version must match checkout.
        let checkoutPrintProof: string | null = null;
        if (document.documentType === PACKING_SLIP_DOCUMENT_TYPE && document.truckVisitId
            && this.files.packingSlipFileAvailable(document)) {
            const visit = await this.visits.findOne({ where: { id: document.truckVisitId } });
            if (visit?.status === VisitStatuses.DOCK_COMPLETE) {
                checkoutPrintProof = this.checkoutPrintProof.issue(document);
            }
        }
        return { document, stream: createReadStream(absolute), checkoutPrintProof };
    }
    async slipHtml(id: number) {
        const visit = await this.get(id);
        const settingsRows = await this.dataSource.query(`SELECT key, value FROM app_settings WHERE key IN ('site_name','slip_footer','plant_location_name')`);
        const settings = new Map<string, string>(settingsRows.map((row: any) => [row.key, row.value]));
        return renderTruckVisitSlipHtml(visit, settings);

    }
}
