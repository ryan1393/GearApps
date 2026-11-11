import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, defer, EMPTY, expand, forkJoin, map, Observable, of, reduce, throwError } from 'rxjs';
import { LabelPrinterChoiceService } from '@meshforge/manufacturing/frontend/util-common';
import { ContainerWorkflowEligibility, TrayWorkflowEligibility } from '@meshforge/manufacturing/shared/util-constants';
import {
  BladeHistoryEvent,
  BladeStatus,
  IBlade,
  IBladeTray,
  IContainer,
  IContainerTray,
  ILocation,
  ILocationTray,
  IPaginatedResponse,
  IPartSummary,
  ITray,
  IPartType,
} from '@meshforge/manufacturing/shared/util-types';


/** Shown to operators when the server cannot list workflow rows (its version is older than this app's). */
export const WORKFLOW_LIST_OUTDATED = 'The list could not be loaded because the server needs an update. Scanning still works; please tell your supervisor.';

/** LOCATION_SUMMARY: a location's summary tag, whose barcode is its Summary and part type. */
export type AssetTagKind = 'TRAY' | 'CONTAINER' | 'LOCATION' | 'LOCATION_SUMMARY';

export interface AssetTagPrintResult {
  kind: AssetTagKind;
  record_id: string;
  serial_number: string;
  language: 'IPL' | 'ZPL';
  symbology: 'CODE128';
  printed: boolean;
  printer_configured: boolean;
  printer_name: string | null;
  failure_reason: string | null;
  file_name: string;
  prn_base64: string;
  message: string;
}

export type InventoryLookupKind = 'tray' | 'container' | 'location';

export interface TrayDetails {
  tray: ITray;
  blades: IBladeTray[];
  location: ILocationTray | null;
  container: IContainerTray | null;
}

export interface InventoryLookupResult {
  kind: InventoryLookupKind;
  value: InventoryTrayRow | InventoryContainerRow | InventoryLocationRow;
}

export interface InventoryBladeRow extends IBlade {
  current_tray: {
    id: string;
    serial_number: string;
    stage_code: string | null;
    stage_name: string | null;
  } | null;
  scrap_details: {
    occurred_at: string;
    notes: string | null;
    tray_serial_number: string | null;
    actor: string | null;
  } | null;
}

export interface BladeHistoryView {
  id: string;
  event_type: BladeHistoryEvent;
  from_status: BladeStatus | null;
  to_status: BladeStatus | null;
  service_cycle: number;
  notes: string | null;
  occurred_at: string;
  tray_serial_number: string | null;
  container_serial_number: string | null;
  actor: string | null;
}

export interface InventoryTrayBladeRow {
  id: string;
  serial_number: string;
  status: string;
  service_cycle: number;
  summary_number: string | null;
  part_type_code: string | null;
}

export interface InventoryTrayRow extends ITray {
  workflow_eligibility?: TrayWorkflowEligibility;
  pending_grinding_count?: number;
  current_cutter_build?: { id: string } | null;
  blades: InventoryTrayBladeRow[];
  current_container: {
    id: string;
    serial_number: string;
  } | null;
  current_location: {
    id: string;
    serial_number: string;
    number: string;
    description: string | null;
    department: string | null;
    location_type: string;
  } | null;
}

export interface InventoryContainedTrayRow {
  id: string;
  serial_number: string;
  blade_count: number;
  summary_number: string | null;
  part_type_code: string | null;
  stage_code: string | null;
  stage_name: string | null;
  blades: InventoryTrayBladeRow[];
}

/** One complete set moved out of its tray into a coater container. */
export interface ContainerBladeSetRow {
  id: string;
  summary_number: string | null;
  part_type_code: string | null;
  required_blade_count: number;
  location_serial_number: string | null;
  packed_from_tray_serial_number: string | null;
  packed_at: string;
  stage_code: 'PACKED_FOR_COATER' | 'AT_COATER' | 'NEEDS_REVIEW';
  blades: InventoryTrayBladeRow[];
}

export interface InventoryContainerRow extends IContainer {
  workflow_eligibility?: ContainerWorkflowEligibility;
  tray_count: number;
  blade_count: number;
  trays: InventoryContainedTrayRow[];
  /** Set when the container holds a blade set rather than whole trays. */
  blade_set?: ContainerBladeSetRow | null;
}

/** Where a complete set goes after grinding. */
export interface GrindingPacking {
  destination: 'CONTAINER' | 'TRAY';
  containerSerialNumber?: string;
}

export interface InventoryLocationTrayRow extends InventoryContainedTrayRow {
  blades: InventoryTrayBladeRow[];
}

export interface InventoryLocationRow extends ILocation {
  tray_count: number;
  blade_count: number;
  trays: InventoryLocationTrayRow[];
}


export interface BladeTrackingDashboardData {
  generated_at: string;
  counts: {
    blades_in_process: number;
    trays_at_coater: number;
    /** Blade sets in coater containers (absent on servers before container sets). */
    sets_at_coater?: number;
    sets_packed_for_coater?: number;
    trays_in_house: number;
    total_trays: number;
    movements_today: number;
  };
  stage_breakdown: Array<{
    code: string;
    name: string;
    tray_count: number;
    blade_count: number;
  }>;
  top_locations: Array<{
    id: string;
    serial_number: string;
    number: string;
    description: string | null;
    department: string | null;
    location_type: string;
    tray_count: number;
    blade_count: number;
  }>;
  coater_containers: Array<{
    id: string;
    serial_number: string;
    tray_count: number;
    blade_count: number;
  }>;
  recent_activity: Array<{
    type: 'LOCATION_MOVE' | 'CONTAINER_LOAD' | 'CONTAINER_RETURN';
    occurred_at: string;
    title: string;
    detail: string;
    tray_serial_number: string;
    destination_serial_number: string;
  }>;
}


export interface InventoryAvailabilityTray {
  id: string;
  serial_number: string;
  part_type_code: string | null;
  blade_count: number;
  required_blade_count: number | null;
  location_serial: string | null;
  container_serial: string | null;
}

export interface InventoryAvailabilityStage {
  code: string;
  name: string;
  tray_count: number;
  trays: InventoryAvailabilityTray[];
}

export interface InventoryAvailabilityData {
  summary_id: string;
  summary_number: string;
  part_type_id: string | null;
  part_type_code: string | null;
  total_trays: number;
  stages: InventoryAvailabilityStage[];
  shelved_cutter_bodies: { total: number; with_blades: number; empty: number };
  blade_requirements: Array<{part_type_id: string; part_type_code: string; required_blade_count: number}>;
  notes: string[];
}

export interface EmptyBodyShelfView {
  body_id: string; body_serial: string; placement_id: string; shelf_serial: string;
  placed_at: string; blade_capacity: number | null; state: string;
}

export interface GrindingMachine { id: string; machine_number: string; department: string; }

export interface TrayGrindingRunView {
  grinding_machine_id?: string | null;
  grinding_machine_number?: string | null;
  tray?: { serial_number: string };
  id: string;
  tray_id: string;
  summary_id: string;
  part_type_id: string;
  starting_blade_count: number;
  returned_blade_count: number;
  scrapped_blade_count: number;
  required_blade_count: number;
  completed_by_user_id: string | null;
  completed_at: string;
  summary?: { number: string; model: string };
  part_type?: { code: string; name: string };
}

@Injectable({ providedIn: 'root' })
export class BladeTrackingApiService {
  private readonly http = inject(HttpClient);
  private readonly printerChoice = inject(LabelPrinterChoiceService);


  printAssetTag(kind: AssetTagKind, recordId: string) {
    return this.http.post<AssetTagPrintResult>('/api/v1/asset-tags/print', {
      kind,
      record_id: recordId,
      // The printer chosen on this computer; left out, the default tag printer is used.
      printer_id: this.printerChoice.selectedId('ASSET_TAG') ?? undefined,
    });
  }

  downloadAssetTagPrn(result: AssetTagPrintResult): void {
    const binary = window.atob(result.prn_base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const url = URL.createObjectURL(
      new Blob([bytes], { type: 'application/octet-stream' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.file_name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Releasing the file straight away can cancel the save in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  getDashboard() {
    return this.http.get<BladeTrackingDashboardData>('/api/v1/trays/dashboard');
  }

  getEmptyBodyShelves() {
    return this.http.get<EmptyBodyShelfView[]>('/api/v1/trays/body-shelves');
  }
  placeEmptyBodyShelf(bodyIdentifier: string, shelfSerial: string) {
    return this.http.post<{body_serial:string;shelf_serial:string;placed:boolean}>('/api/v1/trays/body-shelves/place', {body_identifier:bodyIdentifier,shelf_serial:shelfSerial});
  }
  removeEmptyBodyShelf(bodyIdentifier: string, placementId: string) {
    return this.http.post<{body_serial:string;placed:boolean}>('/api/v1/trays/body-shelves/remove', {body_identifier:bodyIdentifier,placement_id:placementId});
  }

  getInventoryAvailability(summaryId: string, partTypeId = '') {
    const params: Record<string, string> = { summaryId };
    if (partTypeId) params['partTypeId'] = partTypeId;
    return this.http.get<InventoryAvailabilityData>('/api/v1/trays/availability', { params });
  }

  getTrays(page = 1, perPage = 50, search = '') {
    return this.http.get<IPaginatedResponse<InventoryTrayRow>>('/api/v1/trays', {
      params: this.inventoryListParams(page, perPage, search),
    });
  }

  /** Follow real pagination; an operator picker must not stop at the first 50 rows. */
  private allPages<T extends { id: string }>(load: (page: number) => Observable<IPaginatedResponse<T>>): Observable<T[]> {
    return defer(() => {
      let expectedPage = 1;
      return load(expectedPage).pipe(
        expand(result => {
          if (Number(result.meta.page) !== expectedPage || !Array.isArray(result.data)) {
            throw new Error('Inventory pagination changed unexpectedly. Refresh the picker.');
          }
          if (!result.meta.hasNextPage) return EMPTY;
          if (!result.data.length || expectedPage >= 10000) throw new Error('Inventory pagination did not advance.');
          expectedPage += 1;
          return load(expectedPage);
        }),
        reduce((rows, page) => {
          for (const item of page.data) rows.set(item.id, item);
          return rows;
        }, new Map<string, T>()),
        map(rows => [...rows.values()]),
      );
    });
  }

  // The server is older than this app and does not say which rows each workflow may use. Operators
  // cannot fix that, so the message tells them what to do; the cause is for whoever deploys the server.
  getWorkflowTrays(kind: keyof TrayWorkflowEligibility) {
    return this.allPages(page => this.getTrays(page, 50)).pipe(map(rows => {
      if (rows.some(t => !t.workflow_eligibility)) throw new Error(WORKFLOW_LIST_OUTDATED);
      return rows.filter(t => t.workflow_eligibility?.[kind]);
    }));
  }

  getWorkflowContainers(kind: keyof ContainerWorkflowEligibility) {
    return this.allPages(page => this.getContainers(page, 50)).pipe(map(rows => {
      if (rows.some(c => !c.workflow_eligibility)) throw new Error(WORKFLOW_LIST_OUTDATED);
      return rows.filter(c => c.workflow_eligibility?.[kind]);
    }));
  }

  getGrindingMachines() { return this.http.get<GrindingMachine[]>('/api/v1/trays/grinding-machines'); }
  getMachineGrindingRuns(machineId: string) { return this.http.get<TrayGrindingRunView[]>(`/api/v1/trays/grinding-machines/${encodeURIComponent(machineId)}/runs`); }

  startTrayGrinding(trayId: string, grinderId: string) {
    return this.http.post<{ tray_id: string; stage: string }>(
      `/api/v1/trays/${encodeURIComponent(trayId)}/start-grinding`, { grinding_machine_id: grinderId },
    );
  }

  getContainers(page = 1, perPage = 50, search = '') {
    return this.http.get<IPaginatedResponse<InventoryContainerRow>>('/api/v1/containers', {
      params: this.inventoryListParams(page, perPage, search),
    });
  }

  getLocations(page = 1, perPage = 50, search = '') {
    return this.http.get<IPaginatedResponse<InventoryLocationRow>>('/api/v1/locations', {
      params: this.inventoryListParams(page, perPage, search),
    });
  }

  getAllLocations() {
    return this.allPages(page => this.getLocations(page, 50));
  }

  getBlades(page = 1, perPage = 50, search = '') {
    return this.http.get<IPaginatedResponse<InventoryBladeRow>>('/api/v1/blades', {
      params: this.inventoryListParams(page, perPage, search),
    });
  }

  getScrappedBlades(page = 1, perPage = 50, search = '') {
    const params: Record<string, string | number> = {
      page,
      perPage,
      status: BladeStatus.SCRAPPED,
    };
    const normalizedSearch = search.trim();
    if (normalizedSearch) {
      params['search'] = normalizedSearch;
    }

    return this.http.get<IPaginatedResponse<InventoryBladeRow>>('/api/v1/blades', { params });
  }

  getBladeHistory(bladeId: string) {
    return this.http.get<BladeHistoryView[]>(
      `/api/v1/blades/${encodeURIComponent(bladeId)}/history`,
    );
  }

  scanTray(serialNumber: string) {
    return this.http.get<InventoryTrayRow>(`/api/v1/trays/scan/${encodeURIComponent(serialNumber)}`);
  }

  scanContainer(serialNumber: string) {
    return this.http.get<InventoryContainerRow>(`/api/v1/containers/scan/${encodeURIComponent(serialNumber)}`);
  }

  scanLocation(serialNumber: string) {
    return this.http.get<InventoryLocationRow>(`/api/v1/locations/scan/${encodeURIComponent(serialNumber)}`);
  }

  getCurrentTrayLocation(trayId: string) {
    return this.http.get<ILocationTray>(`/api/v1/locationTrays/tray/${encodeURIComponent(trayId)}/current`);
  }

  moveTray(trayId: string, locationId: string) {
    return this.http.post<ILocationTray>('/api/v1/locationTrays', {
      tray_id: trayId,
      location_id: locationId,
    });
  }

  /** Moves the tray's complete set into the empty container; the tray is emptied for reuse. */
  loadTrayIntoContainer(containerId: string, trayId: string) {
    return this.http.post<{ container_serial_number: string; tray_serial_number: string; blade_count: number; location_serial_number: string; tray_emptied: boolean }>('/api/v1/containerTrays', {
      container_id: containerId,
      tray_id: trayId,
    });
  }

  getActiveContainerTrays(containerId: string) {
    return this.http.get<IContainerTray[]>(
      `/api/v1/containerTrays/container/${encodeURIComponent(containerId)}/active`,
    );
  }

  /** Receives a tray packed whole, or a container's blade set into the given empty tray. */
  unloadTray(containerId: string, trayId: string, shelfLocationSerialNumber: string) {
    return this.http.post<unknown>(
      `/api/v1/containerTrays/container/${encodeURIComponent(containerId)}/tray/${encodeURIComponent(trayId)}/unload`,
      { shelf_location_serial_number: shelfLocationSerialNumber },
    );
  }

  private inventoryListParams(page: number, perPage: number, search: string) {
    const params: Record<string, string | number> = { page, perPage };
    const normalizedSearch = search.trim();
    if (normalizedSearch) params['search'] = normalizedSearch;
    return params;
  }

  getPartSummaries() {
    return this.allPages(page => this.http.get<IPaginatedResponse<IPartSummary>>('/api/v1/part-summaries', {
      params: { page, perPage: 50 },
    })).pipe(map(items => items.filter(item => item.enabled)));
  }

  getPartTypes() {
    return this.http.get<IPartType[]>('/api/v1/part-types');
  }

  completeTrayGrinding(
    trayId: string,
    summaryId: string,
    partTypeId: string,
    scrappedBladeCount: number,
    roughShelfSerialNumber?: string,
    grinderId?: string,
    packing?: GrindingPacking,
  ) {
    return this.http.post<{
      grinding_run_id: string;
      starting_blade_count: number;
      scrapped_blade_count: number;
      returned_blade_count: number;
      required_blade_count: number;
      active_blade_count: number;
      blades_needed: number;
      complete: boolean;
      rough_shelf_serial_number: string | null;
      location_serial_number: string | null;
      container_serial_number: string | null;
      tray_emptied: boolean;
    }>(`/api/v1/trays/${encodeURIComponent(trayId)}/complete-grinding`, {
      summary_id: summaryId,
      part_type_id: partTypeId,
      scrapped_blade_count: scrappedBladeCount,
      rough_shelf_serial_number: roughShelfSerialNumber,
      grinding_machine_id: grinderId,
      destination: packing?.destination,
      container_serial_number: packing?.destination === 'CONTAINER' ? packing.containerSerialNumber : undefined,
    });
  }

  getTrayGrindingRuns(trayId: string) {
    return this.http.get<TrayGrindingRunView[]>(
      `/api/v1/trays/${encodeURIComponent(trayId)}/grinding-runs`,
    );
  }

  getTrayReadiness(trayId: string) {
    return this.http.get<{
      grinding_complete: boolean;
      required_blade_count: number | null;
      active_blade_count: number;
      blades_needed: number | null;
      complete: boolean;
    }>(`/api/v1/trays/${encodeURIComponent(trayId)}/readiness`);
  }

  createBladeBatch(input: {
    trayId: string;
    summaryId: string;
    partTypeId: string;
    quantity: number;
    status: BladeStatus;
  }) {
    return this.http.post<{
      quantity: number;
      tray_blade_count: number;
      required_blade_count: number | null;
      complete: boolean;
    }>('/api/v1/bladeTrays/batch', {
      tray_id: input.trayId,
      summary_id: input.summaryId,
      part_type_id: input.partTypeId,
      quantity: input.quantity,
      status: input.status,
      service_cycle: 0,
    });
  }

  getTrayDetails(tray: ITray): Observable<TrayDetails> {
    return forkJoin({
      blades: this.http
        .get<IBladeTray[]>(`/api/v1/bladeTrays/tray/${encodeURIComponent(tray.id)}/active`),
      location: this.getCurrentTrayLocation(tray.id).pipe(catchError((error: HttpErrorResponse) => error.status === 404 ? of(null) : throwError(() => error))),
      container: this.http
        .get<IContainerTray>(`/api/v1/containerTrays/tray/${encodeURIComponent(tray.id)}/current`)
        .pipe(catchError((error: HttpErrorResponse) => error.status === 404 ? of(null) : throwError(() => error))),
    }).pipe(map((details) => ({ tray, ...details })));
  }

  lookup(serialNumber: string): Observable<InventoryLookupResult> {
    const serial = serialNumber.trim().toUpperCase();
    return this.scanTray(serial).pipe(
      map((value) => ({ kind: 'tray' as const, value })),
      catchError((error: HttpErrorResponse) => error.status !== 404 ? throwError(() => error) :
        this.scanContainer(serial).pipe(
          map((value) => ({ kind: 'container' as const, value })),
          catchError((containerError: HttpErrorResponse) => containerError.status !== 404 ? throwError(() => containerError) :
            this.scanLocation(serial).pipe(
              map((value) => ({ kind: 'location' as const, value })),
            ),
          ),
        ),
      ),
    );
  }

  resolveBladeRequirement(summaryId: string, partTypeId: string) {
    return this.http.get<{ required_blade_count: number }>(
      '/api/v1/cutter-config/blade-requirements/resolve',
      { params: { summaryId, partTypeId } },
    );
  }
}

export function apiErrorText(error: HttpErrorResponse | Error, fallback: string): string {
  const message = 'error' in error ? error.error?.message : error.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
}
