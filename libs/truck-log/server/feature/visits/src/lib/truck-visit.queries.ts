import { BadRequestException } from '@nestjs/common';
import { In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { VisitStatuses } from '@truck-log/shared/contracts';
import { TruckVisit } from '@truck-log/server/data-access';
import { VisitEvent } from '@truck-log/server/data-access';
import { DELIVERY_SCAN_EVENT, DELIVERY_MANUAL_EVENT, deliveryScanNote, deliveryManualNote, scannedDeliveryNumbers } from './visit-delivery-scans';
import { PACKING_SLIP_DOCUMENT_TYPE, isVisitStatus } from './truck-visit.model';
import { VisitDocumentFileStorage } from './visit-document-file-storage';

/**
 * Read-only visit lists: open/history search, dashboard counts and Dock Board.
 * A plain class constructed by TruckVisitsService (not a Nest provider).
 */
export class TruckVisitQueries {
    constructor(
        private readonly visits: Repository<TruckVisit>,
        private readonly events: Repository<VisitEvent>,
        private readonly files: VisitDocumentFileStorage,
        private readonly timeZone: () => string,
    ) { }
    /** One bounded-to-returned-visits event query; no per-row PDF access or fake document. */
    async withScannedDeliveryNumbers(visits: TruckVisit[]): Promise<TruckVisit[]> {
        if (!visits.length) return visits;
        const facts = await this.events.find({
            where: { truckVisitId: In([...new Set(visits.map((visit) => visit.id))]), eventType: In([DELIVERY_SCAN_EVENT, DELIVERY_MANUAL_EVENT]) },
            order: { id: 'ASC' },
        });
        const byVisit = new Map<number, VisitEvent[]>();
        for (const fact of facts) {
            const group = byVisit.get(fact.truckVisitId) || [];
            group.push(fact); byVisit.set(fact.truckVisitId, group);
        }
        for (const visit of visits) visit.scannedDeliveryNumbers = scannedDeliveryNumbers(visit.id, byVisit.get(visit.id) || []);
        return visits;
    }
    /** One grouped count for the returned visits (TypeORM 1.x removed loadRelationCountAndMap). */
    async withDocumentCounts(visits: TruckVisit[]): Promise<TruckVisit[]> {
        if (!visits.length) return visits;
        const rows: { visitId: number | string; documentCount: number | string }[] = await this.visits.manager
            .createQueryBuilder()
            .select('document.truck_visit_id', 'visitId')
            .addSelect('COUNT(*)', 'documentCount')
            .from('visit_documents', 'document')
            .where('document.truck_visit_id IN (:...visitIds)', { visitIds: [...new Set(visits.map((visit) => visit.id))] })
            .groupBy('document.truck_visit_id')
            .getRawMany();
        const counts = new Map(rows.map((row) => [Number(row.visitId), Number(row.documentCount)]));
        for (const visit of visits) visit.documentCount = counts.get(visit.id) ?? 0;
        return visits;
    }
    applySearch(query: SelectQueryBuilder<TruckVisit>, q?: string) {
        if (!q?.trim())
            return;
        const needle = `%${q.trim()}%`;
        const scanNumber = /^[0-9]{8}$/.test(q.trim()) ? q.trim() : null;
        const scanSearch = scanNumber ? ` OR EXISTS (SELECT 1 FROM visit_events saved_scan
          WHERE saved_scan.truck_visit_id = visit.id AND (
            (saved_scan.event_type = :scanType AND saved_scan.notes = :scanNote) OR
            (saved_scan.event_type = :manualType AND saved_scan.notes = :manualNote)))` : '';
        query.andWhere(`(
      visit.visit_number ILIKE :needle OR
      CONCAT('TL-', LPAD(CAST(visit.id AS text), 6, '0')) ILIKE :needle OR
      visit.load_number ILIKE :needle OR
      visit.driver_name ILIKE :needle OR visit.driver_phone ILIKE :needle OR
      visit.carrier_name ILIKE :needle OR visit.trailer_id ILIKE :needle OR
      visit.tractor_id ILIKE :needle OR
      visit.dock_code ILIKE :needle${scanSearch}
    )`, { needle, ...(scanNumber ? { scanType: DELIVERY_SCAN_EVENT, scanNote: deliveryScanNote(scanNumber), manualType: DELIVERY_MANUAL_EVENT, manualNote: deliveryManualNote(scanNumber) } : {}) });
    }
    async listOpen(q?: string) {
        const query = this.visits.createQueryBuilder('visit')
            .where('visit.status <> :closed', { closed: VisitStatuses.GUARD_CHECKED_OUT })
            .orderBy('visit.guard_check_in_at', 'DESC');
        this.applySearch(query, q);
        return this.withScannedDeliveryNumbers(await this.withDocumentCounts(await query.getMany()));
    }
    async history(q?: string, status = 'ALL', date?: string, limit = 100) {
        const safeLimit = Number.isFinite(limit)
            ? Math.min(Math.max(Math.trunc(limit), 1), 500)
            : 100;
        const query = this.visits.createQueryBuilder('visit')
            .orderBy('visit.guard_check_in_at', 'DESC')
            .take(safeLimit);
        if (status === 'ACTIVE') {
            query.andWhere('visit.status <> :closed', { closed: VisitStatuses.GUARD_CHECKED_OUT });
        }
        else if (isVisitStatus(status)) {
            query.andWhere('visit.status = :status', { status });
        }
        if (date?.trim()) {
            const visitDate = date.trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
                throw new BadRequestException('Date filter must use YYYY-MM-DD.');
            }
            query.andWhere('(visit.guard_check_in_at AT TIME ZONE :timeZone)::date = :visitDate', { timeZone: this.timeZone(), visitDate });
        }
        this.applySearch(query, q);
        return this.withScannedDeliveryNumbers(await this.withDocumentCounts(await query.getMany()));
    }
    async dashboard() {
        const timeZone = this.timeZone();
        const activePreview = this.visits.createQueryBuilder('visit')
            .where('visit.status <> :closed', { closed: VisitStatuses.GUARD_CHECKED_OUT })
            .orderBy('visit.guard_check_in_at', 'DESC')
            .take(30)
            .getMany()
            .then((visits) => this.withDocumentCounts(visits));
        const awaitingGuard = this.visits.find({
            where: { status: VisitStatuses.DOCK_COMPLETE },
            order: { dockCompletedAt: 'ASC', guardCheckInAt: 'ASC' },
        });
        const [open, atDock, awaitingExit, checkedOutToday, activeTrucks, awaitingGuardVisits] = await Promise.all([
            this.visits.count({ where: { status: Not(VisitStatuses.GUARD_CHECKED_OUT) } }),
            this.visits.count({ where: { status: VisitStatuses.DOCK_ASSIGNED } }),
            this.visits.count({ where: { status: VisitStatuses.DOCK_COMPLETE } }),
            this.visits.createQueryBuilder('visit')
                .where('visit.status = :closed', { closed: VisitStatuses.GUARD_CHECKED_OUT })
                .andWhere('(visit.guard_check_out_at AT TIME ZONE :timeZone)::date = (CURRENT_TIMESTAMP AT TIME ZONE :timeZone)::date', { timeZone })
                .getCount(),
            activePreview,
            awaitingGuard,
        ]);
        await this.withScannedDeliveryNumbers([...activeTrucks, ...awaitingGuardVisits]);
        return {
            open,
            atDock,
            awaitingExit,
            checkedOutToday,
            activeTrucks,
            awaitingGuard: awaitingGuardVisits,
        };
    }
    async dockBoard() {
        const visits = await this.visits.find({
            where: { status: In([VisitStatuses.DOCK_ASSIGNED]) },
            relations: { documents: true },
            order: { dockCode: 'ASC', guardCheckInAt: 'ASC' },
        });
        for (const visit of visits) {
            visit.documents = [...(visit.documents || [])]
                .sort((left, right) => right.scannedAt.getTime() - left.scannedAt.getTime());
            for (const document of visit.documents) {
                if (document.documentType === PACKING_SLIP_DOCUMENT_TYPE) document.fileAvailable = this.files.packingSlipFileAvailable(document);
            }
        }
        return this.withScannedDeliveryNumbers(visits);
    }
}
