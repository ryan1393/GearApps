import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TruckDirections, VisitStatuses, type TruckDirection, type VisitStatus } from '@truck-log/shared/contracts';
import type { TruckVisit } from '@truck-log/server/data-access';
import type { RxoShipmentIdentity } from '@truck-log/server/domain/rxo';
import { CreateTruckVisitDto } from './dto/create-truck-visit.dto';

/** Constants and pure helpers shared by the truck-visit lifecycle modules. */

export const VALID_VISIT_STATUSES = new Set<string>(Object.values(VisitStatuses));
export const PACKING_SLIP_DOCUMENT_TYPE = 'PACKING_SLIP';

export function normalizeActor(actor?: string) {
    return actor?.trim() || null;
}
export function isVisitStatus(status: string): status is VisitStatus {
    return VALID_VISIT_STATUSES.has(status);
}
export interface AppSettingRow {
    key: string;
    value: string | null;
}
export interface NormalizedVisitCreate {
    loadNumber: string;
    direction: TruckDirection;
    carrierName: string;
    driverName: string;
    driverPhone: string;
    tractorId: string;
    trailerId: string;
    isDropTrailer: boolean;
    originName: string;
    destinationName: string;
    dockCode: string;
    notes: string | null;
    actor: string | null;
    rxoIdentity: RxoShipmentIdentity | null;
    clientRequestId: string | null;
    guardGate: 'EAST' | 'WEST' | null;
    manualPrinting?: boolean;
}
export function makeVisitNumber(now = new Date()) {
    const pad = (value: number) => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `VISIT-${date}-${time}-${randomBytes(4).toString('hex').toUpperCase()}`;
}
export function makeFolderKey(visitNumber: string, now = new Date()) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate()), visitNumber].join('/');
}
export function normalizeDriverPhone(value: string) {
    const phone = String(value || '').trim();
    if (!phone) {
        throw new BadRequestException('Driver phone number is required.');
    }
    if (!/^\+?[0-9()\s.-]+$/.test(phone)) {
        throw new BadRequestException('Driver phone number must be a valid phone number.');
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
        throw new BadRequestException('Driver phone number must contain 7 to 15 digits.');
    }
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return phone;
}
export function normalizeRxoIdentity(dto: CreateTruckVisitDto, loadNumber: string): RxoShipmentIdentity | null {
    const supplied = [dto.rxoSiteKey, dto.rxoShipmentId, dto.rxoDirection]
        .map((value) => value !== undefined && value !== null);
    if (!supplied.some(Boolean))
        return null;
    if (!supplied.every(Boolean)) {
        throw new BadRequestException('RXO site, shipment, and direction must be supplied together.');
    }
    const siteKey = String(dto.rxoSiteKey).trim().toLowerCase();
    const shipmentId = String(dto.rxoShipmentId).trim().toUpperCase();
    const direction = String(dto.rxoDirection).trim().toUpperCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(siteKey)) {
        throw new BadRequestException('The RXO site identifier is invalid.');
    }
    if (!shipmentId || shipmentId.length > 120 || /[\u0000-\u001f\u007f/\\]/.test(shipmentId)) {
        throw new BadRequestException('The RXO shipment identifier is invalid.');
    }
    if (direction !== TruckDirections.INBOUND && direction !== TruckDirections.OUTBOUND) {
        throw new BadRequestException('The RXO direction is invalid.');
    }
    if (direction !== dto.direction) {
        throw new BadRequestException('RXO shipment direction must match the truck visit direction.');
    }
    if (shipmentId !== loadNumber) {
        throw new BadRequestException('RXO shipment identity must exactly match the selected Load Number.');
    }
    return { siteKey, shipmentId, direction };
}
export function assertIdempotentVisitMatches(visit: TruckVisit, input: NormalizedVisitCreate) {
    const matches = visit.loadNumber === input.loadNumber
        && visit.direction === input.direction
        && visit.carrierName === input.carrierName
        && visit.driverName === input.driverName
        && visit.driverPhone === input.driverPhone
        && visit.tractorId === input.tractorId
        && visit.trailerId === input.trailerId
        && visit.isDropTrailer === input.isDropTrailer
        && visit.originName === input.originName
        && visit.destinationName === input.destinationName
        && visit.dockCode === input.dockCode
        && (visit.manualPrinting ?? false) === (input.manualPrinting ?? false)
        && visit.notes === input.notes
        && visit.rxoSiteKey === (input.rxoIdentity?.siteKey ?? null)
        && visit.rxoShipmentId === (input.rxoIdentity?.shipmentId ?? null)
        && visit.rxoDirection === (input.rxoIdentity?.direction ?? null);
    if (!matches) {
        throw new ConflictException('This clientRequestId was already used for a different truck check-in request.');
    }
}
