import { DestroyRef, Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, catchError, forkJoin, map, of, timeout } from 'rxjs';
import { Poller, createPoller } from '@truck-log/web/data-access';

export interface ExpediteStatus {
  source: 'RXO_EXPEDITE'; version: string; schedulingEnabled: boolean; databaseIngestionEnabled: boolean;
  credentialUpdatesEnabled: boolean; controlOrigin: string | null; transportWarning: boolean;
  credentials: { username: string; usernameConfigured: boolean; passwordConfigured: boolean; configured: boolean };
  scheduler?: { state: string; intervalMinutes: number; syncOnStart: boolean; schedulerStartedAt: string | null; schedulerHeartbeatAt: string | null; currentStartedAt: string | null; nextRunAt: string | null; lastCompletedAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; lastErrorCode: string | null; lastDurationSeconds: number | null; lastSourceBatchId: string | null };
  settings?: { intervalMinutes: number; syncOnStart: boolean };
  acquisition: { state: string; lastError: string | null; lastAttemptAt: string | null; lastSuccessfulExport: string | null; shipmentCount: number | null; sourceBatchId: string | null };
  database?: { enabled: boolean; state: string; latestVerifiedBatch: string | null; lastImportedBatch: string | null; importedAt: string | null; sourceCompletedAt: string | null; rowCount: number | null; linkedOrders: number | null; pendingBatch: string | null; errorMessage: string | null };
}

export interface ExpediteDriverDocumentState {
  status: 'NO_DOCUMENT' | 'READY' | 'PRINTING' | 'PRINTED' | 'PRINT_FAILED';
  activeDocumentId?: number;
  version?: number;
  fileName?: string;
  uploadedAt?: string | null;
  printedAt?: string | null;
  agentOnline?: boolean;
}

export interface ExpediteShipment { shipmentId: string; critical: boolean | null; authCode: string | null; originName: string | null; origin: string | null; destination: string | null; scac: string | null; commodity: string | null; mode: string | null; currentLocation: string | null; nextStop: string | null; etaNextStop: string | number | null; etaStatus: string | null; driverDocument?: ExpediteDriverDocumentState; }

export interface ExpediteShipmentsResponse { contractVersion: 1; source: 'RXO_EXPEDITE'; sourceBatchId: string; completedAt: string; rowCount: number; shipments: ExpediteShipment[]; storage?: 'POSTGRESQL' | 'NATIVE_VERIFIED' | 'NATIVE_FALLBACK'; databaseImportedAt?: string | null; }

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validates the parts of GET /api/v1/rxo/expedite the screens read before using them. */
export function isExpediteStatus(value: unknown): value is ExpediteStatus {
  if (!isObject(value) || value['source'] !== 'RXO_EXPEDITE') return false;
  const credentials = value['credentials'];
  const acquisition = value['acquisition'];
  if (!isObject(credentials) || typeof credentials['username'] !== 'string'
    || typeof credentials['usernameConfigured'] !== 'boolean' || typeof credentials['passwordConfigured'] !== 'boolean') return false;
  if (!isObject(acquisition) || typeof acquisition['state'] !== 'string') return false;
  const scheduler = value['scheduler'];
  if (scheduler !== undefined && scheduler !== null && (!isObject(scheduler) || typeof scheduler['state'] !== 'string')) return false;
  const database = value['database'];
  if (database !== undefined && database !== null && !isObject(database)) return false;
  return true;
}

export function isExpediteShipmentsResponse(value: unknown): value is ExpediteShipmentsResponse {
  if (!isObject(value)) return false;
  const shipments = value['shipments'];
  return value['source'] === 'RXO_EXPEDITE'
    && value['contractVersion'] === 1
    && Array.isArray(shipments)
    && value['rowCount'] === shipments.length;
}

type Fetched<T> = { value: T | null; failed: boolean };

/**
 * One RXO Expedite data source per Control Center page: status and shipments are
 * polled together every 5 s (never overlapping) and shared by the KPI cards, the
 * Data tab, the Exporter Health tab and Settings. Last good values are retained
 * on failure; `stale` and the error fields say what could not be refreshed.
 */
@Injectable()
export class RxoExpediteStore {
  private readonly http = inject(HttpClient);
  status: ExpediteStatus | null = null;
  shipments: ExpediteShipmentsResponse | null = null;
  statusReceivedAt = 0;
  statusError = '';
  shipmentsError = '';
  /** Emits every newly accepted status so editors can sync fields that are not being edited. */
  readonly statusUpdates = new Subject<ExpediteStatus>();
  readonly poller: Poller<{ status: Fetched<ExpediteStatus>; shipments: Fetched<ExpediteShipmentsResponse> }>;

  constructor() {
    this.poller = createPoller({
      intervalMs: 5000,
      timeoutMs: 50000,
      destroyRef: inject(DestroyRef),
      load: () => forkJoin({
        status: this.fetch('/api/v1/rxo/expedite', isExpediteStatus),
        shipments: this.fetch('/api/v1/rxo/expedite/shipments', isExpediteShipmentsResponse),
      }).pipe(map((result) => {
        // A failed status read is a failed refresh: "Updated" must not advance.
        if (result.status.failed) {
          this.statusError = this.status
            ? 'RXO Expedite status could not be refreshed. Showing the last confirmed status.'
            : 'Expedite status is unavailable. Verify the dedicated image and control configuration. Standard RXO is unaffected.';
          this.applyShipments(result.shipments);
          throw new Error('RXO Expedite status refresh failed');
        }
        return result;
      })),
      next: ({ status, shipments }) => {
        if (status.value) {
          this.status = status.value;
          this.statusReceivedAt = Date.now();
          this.statusError = '';
          this.statusUpdates.next(status.value);
        }
        this.applyShipments(shipments);
      },
    });
  }

  get lastUpdated(): Date | null { return this.poller.lastUpdated(); }
  /** True when the latest status or shipment refresh failed and older data is on screen. */
  get stale(): boolean { return this.poller.stale() || !!this.shipmentsError; }

  refresh() { this.poller.refresh(); }

  private applyShipments(shipments: Fetched<ExpediteShipmentsResponse>) {
    if (shipments.value) { this.shipments = shipments.value; this.shipmentsError = ''; return; }
    if (shipments.failed) {
      this.shipmentsError = this.shipments
        ? 'Verified Expedite shipments could not be refreshed. Showing the last confirmed batch.'
        : 'Verified Expedite shipments are unavailable. The last export remains retained and standard RXO is unaffected.';
    }
  }

  private fetch<T>(url: string, valid: (value: unknown) => value is T): Observable<Fetched<T>> {
    return this.http.get<unknown>(url).pipe(
      timeout(50000),
      map((value): Fetched<T> => valid(value) ? { value, failed: false } : { value: null, failed: true }),
      catchError(() => of<Fetched<T>>({ value: null, failed: true })),
    );
  }
}
