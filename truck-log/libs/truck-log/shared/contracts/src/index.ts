/** Truck Log release. Must equal the VERSION file (checked by tests/new-host/test-release-version.mjs). */
export const TRUCK_LOG_VERSION = '1.0.1';

export const VisitStatuses = {
    DOCK_ASSIGNED: 'DOCK_ASSIGNED',
    DOCK_COMPLETE: 'DOCK_COMPLETE',
    GUARD_CHECKED_OUT: 'GUARD_CHECKED_OUT',
} as const;
export type VisitStatus = (typeof VisitStatuses)[keyof typeof VisitStatuses];
export const TruckDirections = {
    INBOUND: 'INBOUND',
    OUTBOUND: 'OUTBOUND',
} as const;
export type TruckDirection = (typeof TruckDirections)[keyof typeof TruckDirections];
export type RxoDirection = 'INBOUND' | 'OUTBOUND';

export const RxoDriverDocumentStatuses = {
    NO_DOCUMENT: 'NO_DOCUMENT',
    READY: 'READY',
    PRINTING: 'PRINTING',
    PRINTED: 'PRINTED',
    PRINT_FAILED: 'PRINT_FAILED',
} as const;
export type RxoDriverDocumentStatus = (typeof RxoDriverDocumentStatuses)[keyof typeof RxoDriverDocumentStatuses];

export interface RxoDriverDocumentSummary {
    status: RxoDriverDocumentStatus;
    activeDocumentId?: number | null;
    version?: number | null;
    fileName?: string | null;
    uploadedAt?: string | null;
    printedAt?: string | null;
    recoverable?: boolean;
    cancelled?: boolean;
    replacementPackageId?: string | null;
    agentOnline?: boolean | null;
}

export const DriverPrintItemTypes = {
    DOCK_ASSIGNMENT: 'DOCK_ASSIGNMENT',
    RXO_DOCUMENT: 'RXO_DOCUMENT',
} as const;
export type DriverPrintItemType = (typeof DriverPrintItemTypes)[keyof typeof DriverPrintItemTypes];

export const DriverPrintItemStatuses = {
    PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
    QUEUED: 'QUEUED',
    LEASED: 'LEASED',
    PRINTED: 'PRINTED',
    FAILED: 'FAILED',
} as const;
export type DriverPrintItemStatus = (typeof DriverPrintItemStatuses)[keyof typeof DriverPrintItemStatuses];

export interface DriverPrintItemRecord {
    id: string;
    itemType: DriverPrintItemType;
    status: DriverPrintItemStatus;
    error?: string | null;
    printedAt?: string | null;
    recoverable?: boolean;
    cancelled?: boolean;
    replacementPackageId?: string | null;
}

export interface DriverPrintPackageRecord {
    automaticDockAssignment?: boolean;

    packageId: string;
    status: string;
    frozenRxoDocumentId?: number | null;
    frozenRxoDocumentVersion?: number | null;
    frozenRxoDocumentFileName?: string | null;
    items: DriverPrintItemRecord[];
}

export interface CreateTruckVisitRequest {
    autoPrintDockSlip?: boolean;

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
    notes?: string;
    actor?: string;
    rxoSiteKey?: string;
    rxoShipmentId?: string;
    rxoDirection?: RxoDirection;
    guardGate?: 'EAST' | 'WEST';
  clientRequestId?: string;
}
export interface CheckInConfigRecord {
    printingUnavailableReason?: string;
    automaticDriverPrinting?: boolean;

    plantLocationName: string;
}
export interface ScheduledLoadLookupRecord {
    found: boolean;
    loadNumber: string;
    scheduledAt: string | null;
}
export const PackingSlipExtractionStatuses = {
    DETECTED: 'DETECTED',
    NOT_FOUND: 'NOT_FOUND',
    AMBIGUOUS: 'AMBIGUOUS',
    NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type PackingSlipExtractionStatus = (typeof PackingSlipExtractionStatuses)[keyof typeof PackingSlipExtractionStatuses];
export interface VisitDocumentRecord {
    /** Response-only storage availability. Never persisted as a database column. */
    fileAvailable?: boolean;
    id: number;
    truckVisitId: number | null;
    fileName: string;
    originalFileName?: string | null;
    storedFileName: string;
    relativePath: string;
    documentType?: string | null;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
    pageCount?: number | null;
    extractedDocumentId?: string | null;
    extractionStatus?: PackingSlipExtractionStatus | null;
    extractionMethod?: string | null;
    extractionMessage?: string | null;
    scannedAt: string;
    scannedBy?: string | null;
    sourceKind?: string | null;
    sha256?: string | null;
    rxoDocumentVersion?: number | null;
    rxoIsActive?: boolean;
}
export interface VisitEventRecord {
    id: number;
    truckVisitId: number;
    eventType: string;
    occurredAt: string;
    actor?: string | null;
    notes?: string | null;
}
export function formatVisitReference(id: number) {
    const safeId = Number.isFinite(id) ? Math.max(0, Math.trunc(id)) : 0;
    return `TL-${String(safeId).padStart(6, '0')}`;
}

export interface TruckVisitRecord {
    id: number;
    visitReference: string;
    visitNumber: string;
    loadNumber?: string | null;
    direction: TruckDirection;
    carrierId?: number | null;
    carrierName: string;
    driverId?: number | null;
    driverName: string;
    driverPhone?: string | null;
    tractorId?: string | null;
    trailerId: string;
    isDropTrailer: boolean;
    originLocationId?: number | null;
    originName?: string | null;
    destinationLocationId?: number | null;
    destinationName?: string | null;
    dockCode: string;
    notes?: string | null;
    status: VisitStatus;
    documentFolderKey: string;
    documentCount?: number;
    scheduledAt?: string | null;
    guardCheckInAt: string;
    dockAssignedAt?: string | null;
    dockCompletedAt?: string | null;
    guardCheckOutAt?: string | null;
    documents?: VisitDocumentRecord[];
    events?: VisitEventRecord[];
    /** Persisted visit scan history, projected separately from attached PDFs. */
    scannedDeliveryNumbers?: string[];
    rxoSiteKey?: string | null;
    rxoShipmentId?: string | null;
    rxoDirection?: RxoDirection | null;
    driverPrintPackage?: DriverPrintPackageRecord | null;
}
export interface DockRecord {
    id: number;
    code: string;
    description?: string | null;
    active: boolean;
    sortOrder: number;
}
export interface DashboardData {
    open: number;
    atDock: number;
    awaitingExit: number;
    checkedOutToday: number;
    activeTrucks: TruckVisitRecord[];
    awaitingGuard: TruckVisitRecord[];
}
export interface DockAgingSettingsRecord {
    warningMinutes: number;
    criticalMinutes: number;
}
export interface ScheduledLoadRecord {
    id: number;
    loadNumber: string;
    scheduledAt: string;
    active: boolean;
    source?: string | null;
}
export interface ScheduledLoadImportResult {
    fileName: string;
    rows: number;
    inserted: number;
    updated: number;
    activeTotal: number;
}
export interface DriverReferenceRecord {
    id: number;
    name: string;
    phoneNumber?: string | null;
    active: boolean;
    lastUsedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
}
export interface CarrierReferenceRecord {
    id: number;
    name: string;
    active: boolean;
    lastUsedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
}
export interface LocationReferenceRecord {
    id: number;
    name: string;
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    active: boolean;
    lastUsedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
}
export interface CheckInReferenceData {
    drivers: DriverReferenceRecord[];
    carriers: CarrierReferenceRecord[];
    locations: LocationReferenceRecord[];
}
export interface HealthData {
    status: string;
    application: string;
    version: string;
    database: string;
    documentStorage: string;
    time: string;
}

export interface RxoDataStatusSummaryRecord {
    status: string;
    count: number;
}

export interface RxoDataPage<T = Record<string, unknown>> {
    kind: 'orders' | 'shipments' | 'freight';
    page: number;
    pageSize: number;
    total: number;
    statusSummary: RxoDataStatusSummaryRecord[];
    rows: T[];
}

export interface RxoOrderRecord {
    site_key: string;
    order_number: string;
    direction: RxoDirection;
    shipment_id?: string | null;
    status?: string | null;
    origin_name?: string | null;
    origin_address?: string | null;
    destination_name?: string | null;
    destination_address?: string | null;
    pickup_at?: string | null;
    delivery_at?: string | null;
    customer_order_number?: string | null;
    tracking_number?: string | null;
    source_batch_id?: string | null;
    visible_in_latest?: boolean;
    last_seen_at?: string | null;
}

export interface RxoShipmentRecord {
    site_key: string;
    shipment_id: string;
    direction: RxoDirection;
    shipment_status?: string | null;
    current_status?: string | null;
    eta_status?: string | null;
    mode?: string | null;
    carrier_name?: string | null;
    plant_scheduled_at?: string | null;
    pickup_estimated_arrival_raw?: string | null;
    pickup_appointment_arrival_raw?: string | null;
    delivery_estimated_arrival_raw?: string | null;
    delivery_appointment_arrival_raw?: string | null;
    orders_site_time?: string | null;
    pro_number?: string | null;
    trailer_number?: string | null;
    first_stop_name?: string | null;
    first_stop_address?: string | null;
    last_stop_name?: string | null;
    last_stop_address?: string | null;
    origin_name?: string | null;
    origin_address?: string | null;
    destination_name?: string | null;
    destination_address?: string | null;
    order_numbers?: string[];
    linked_order_count?: number;
    shipment_visible_in_latest?: boolean;
    freight_visible_in_latest?: boolean;
    shipment_source_batch_id?: string | null;
    visibility_source_batch_id?: string | null;
    driverDocument?: RxoDriverDocumentSummary;
}

export interface RxoFreightRecord {
    site_key: string;
    shipment_id: string;
    direction: RxoDirection;
    status?: string | null;
    eta_status?: string | null;
    mode?: string | null;
    carrier_name?: string | null;
    plant_scheduled_at?: string | null;
    pro_number?: string | null;
    trailer_number?: string | null;
    first_stop_name?: string | null;
    first_stop_address?: string | null;
    last_stop_name?: string | null;
    last_stop_address?: string | null;
    origin_name?: string | null;
    origin_address?: string | null;
    destination_name?: string | null;
    destination_address?: string | null;
    pickup_estimated_arrival_raw?: string | null;
    pickup_appointment_arrival_raw?: string | null;
    delivery_estimated_arrival_raw?: string | null;
    delivery_appointment_arrival_raw?: string | null;
    source_batch_id?: string | null;
    visible_in_latest?: boolean;
    last_seen_at?: string | null;
    driverDocument?: RxoDriverDocumentSummary;
}

export interface RxoImportDatasetHealth {
    pageKey: string;
    direction: string;
    status: string;
    sourceRows: number | null;
    parsedRows: number | null;
    uniqueRows: number | null;
    reason: string | null;
}

export interface RxoImportHealth {
    status: string;
    partial: boolean;
    complete: boolean;
    batchId: string | null;
    datasets: RxoImportDatasetHealth[];
    warnings: string[];
}

export interface RxoImportStatusData {
    importHealth?: RxoImportHealth;
    enabled: boolean;
    boundaryExists: boolean;
    boundaryBatchId?: string | null;
    boundaryCompletedAt?: string | null;
    boundaryPostgresImported?: boolean;
    lastImport?: Record<string, unknown> | null;
    countsBySite: Array<{
        site_key: string;
        orders_visible: number;
        shipments_visible: number;
        freight_visible: number;
    }>;
    rxoScheduledLoads: number;
    authority: { rxo: string; truckLog: string };
}

export interface RxoExporterSettings {
    syncIntervalMinutes: number;
    maxScanDurationMinutes: number;
    noProgressTimeoutMinutes: number;
}

export interface RxoManualRunState {
    id: string;
    status: 'IDLE' | 'QUEUED' | 'EXPORTING' | 'SYNCING' | 'IMPORTING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
    phase: string;
    requestedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
    sourceBatchId?: string | null;
    importSummary?: unknown;
}

export interface RxoSchedulerStatusData {
    service?: string;
    version?: string;
    status?: string;
    schedulerStartedAt?: string | null;
    schedulerHeartbeatAt?: string | null;
    schedulerProcessId?: number | null;
    currentTrigger?: string | null;
    currentPhase?: string | null;
    currentStartedAt?: string | null;
    nextRunAt?: string | null;
    syncIntervalMinutes?: number;
    lastCompletedAt?: string | null;
    lastDurationSeconds?: number | null;
    lastExitCode?: number | null;
    lastBatchId?: string | null;
    lastError?: string | null;
    lastRescanRequestId?: string | null;
    lastRescanRequestedAt?: string | null;
    lastRescanConsumedAt?: string | null;
    maxScanDurationMinutes?: number;
    noProgressTimeoutMinutes?: number;
    exporterChildProcessId?: number | null;
    currentAttempt?: number;
    maxAutomaticRecoveryAttempts?: number;
    automaticRecoveryAttempt?: number;
    recoveryState?: string | null;
    recoveryReason?: string | null;
    recoveryStartedAt?: string | null;
    stallDetectedAt?: string | null;
    stallReason?: string | null;
    lastExporterOutputAt?: string | null;
    lastExporterOutput?: string | null;
    lastExporterOutputStream?: string | null;
    exporterOutputSequence?: number;
    lastRecoveryAt?: string | null;
    lastRecoveryOutcome?: string | null;
    lastRecoveryError?: string | null;
}

export interface RxoControlStatusData {
    serverTime?: string;
    serverEpochMs?: number;
    statusGeneratedAt?: string;
    controlAvailable: boolean;
    dockerConnected: boolean;
    dockerVersion?: string | null;
    exporterRunning: boolean;
    exporterContainerId?: string | null;
    exporterHealth?: {
        service?: string;
        version?: string;
        status?: string;
        updatedAt?: string;
        currentBatchId?: string | null;
        currentStartedAt?: string | null;
        nextRunAt?: string | null;
        lastSuccessAt?: string | null;
        lastFailureAt?: string | null;
        lastBatchId?: string | null;
        lastError?: string | null;
        lastExportCount?: number;
        lastDurationSeconds?: number;
        lastDatasetRows?: Record<string, number>;
        syncIntervalMinutes?: number;
        operationalWindow?: {
            field?: string;
            lookbackDays?: number;
            lookaheadDays?: number;
        };
        lastRescanRequestedAt?: string | null;
    } | null;
    scheduler?: RxoSchedulerStatusData | null;
    settings: RxoExporterSettings;
    /** Fixed active-load/date-fallback window; uncapped exports remain unbounded and Freight On The Move stays live. */
    exportWindow: { lookbackDays: 1; lookaheadDays: 1; timeZone: 'America/Indiana/Indianapolis' };
    credentials: {
        username: string;
        usernameConfigured: boolean;
        passwordConfigured: boolean;
    };
    runtime: {
        checked: boolean;
        verified: boolean;
        expectedSha256?: string | null;
        actualSha256?: string | null;
    };
    manualRun: RxoManualRunState;
    message?: string | null;
}
export type { TvDockRecord, TvVisitRecord, TvBoardSnapshot } from './tv-display.types';

export type { DockScanCandidate, DockScanLookup } from './dock-packing-scan';

export type { DockDeliveryScanReceipt } from './dock-delivery-scan';

export { StationKinds, STATION_PAIRING_CODE_PATTERN, STATION_NAME_MAX } from './station-access';
export type { StationKind, StationStatus, StationIdentity, StationSession, StationRecord, StationPairingResult } from './station-access';

export {
    PACKING_SLIP_ROUTE_COUNT, PACKING_SLIP_ROUTE_NAME_MAX, PACKING_SLIP_ROUTE_QUEUE_MAX, PACKING_SLIP_ROUTE_PRINTER_MAX,
    PackingSlipRouteModes, PACKING_SLIP_ROUTE_MODES, PACKING_SLIP_PRINTER_PATTERN,
    validatePackingSlipRoutes, newlyLivePackingSlipRoutes, confirmLiveMatches, packingSlipRouteChanges, packingSlipEtagMatches,
} from './packing-slip-routes';
export type {
    PackingSlipRouteMode, PackingSlipRoute, PackingSlipRouteConfig, PackingSlipRouteUpdateRequest, PackingSlipRouteField, PackingSlipRouteIssue,
} from './packing-slip-routes';
