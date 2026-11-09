import type { CreateTruckVisitRequest, RxoDirection, TruckDirection } from '@truck-log/shared/contracts';
export interface CheckInForm {
    loadNumber: string;
    direction: TruckDirection | '';
    carrierName: string;
    driverName: string;
    driverPhone: string;
    tractorId: string;
    trailerId: string;
    isDropTrailer: boolean;
    originName: string;
    destinationName: string;
    dockCode: string;
    notes: string;
    actor: string;
}
export type UppercaseCheckInField = 'loadNumber' | 'tractorId' | 'trailerId';
export interface CheckInRxoSelection {
    siteKey: string;
    shipmentId: string;
    direction: RxoDirection;
}
export function emptyCheckInForm(): CheckInForm {
    return {
        loadNumber: '',
        direction: '',
        carrierName: '',
        driverName: '',
        driverPhone: '',
        tractorId: '',
        trailerId: '',
        isDropTrailer: false,
        originName: '',
        destinationName: '',
        dockCode: '',
        notes: '',
        actor: 'Guard',
    };
}
export function toCreateTruckVisitRequest(
    form: CheckInForm,
    rxoSelection?: CheckInRxoSelection | null,
    clientRequestId?: string,
    guardGate?: 'EAST' | 'WEST',
): CreateTruckVisitRequest {
    if (!form.direction)
        throw new Error('Direction is required.');
    const loadNumber = form.loadNumber.trim().toUpperCase();
    if (!loadNumber)
        throw new Error('Load Number is required.');
    const request: CreateTruckVisitRequest = {
        loadNumber,
        direction: form.direction,
        carrierName: form.carrierName,
        driverName: form.driverName,
        driverPhone: form.driverPhone,
        tractorId: form.tractorId,
        trailerId: form.trailerId,
        isDropTrailer: form.isDropTrailer,
        originName: form.originName,
        destinationName: form.destinationName,
        dockCode: form.dockCode,
        notes: form.notes.trim() || undefined,
        actor: form.actor,
    };

    if (rxoSelection) {
        request.rxoSiteKey = rxoSelection.siteKey.trim();
        request.rxoShipmentId = rxoSelection.shipmentId.trim();
        request.rxoDirection = rxoSelection.direction;
    }

    if (guardGate) request.guardGate = guardGate;
    if (clientRequestId?.trim()) request.clientRequestId = clientRequestId.trim();
    return request;
}
