import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { LabelPrinterChoiceService } from '@meshforge/manufacturing/frontend/util-common';
import { IBulkCreateShelfLocations, IBulkShelfLocationsResult } from '@meshforge/manufacturing/shared/util-types';
import { Observable } from 'rxjs';

export interface PagedResponse<T> {
  data: T[];
  /** Paging facts from the API; `hasNextPage` is what tells a loader to stop. */
  meta?: { hasNextPage?: boolean; page?: number; totalPages?: number; totalItems?: number };
}

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

export interface AdminTrayRow {
  id: string;
  serial_number: string;
  blade_count: number;
  enabled: boolean;
  current_stage?: { code?: string | null; name?: string | null } | null;
  current_location?: { serial_number: string } | null;
  current_container?: { serial_number: string } | null;
}

export interface AdminContainerRow {
  id: string;
  serial_number: string;
  tray_count: number;
  blade_count: number;
  enabled: boolean;
}

export interface AdminUser {
  id: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string;
  role: string;
  departmentId?: string | null;
  active: boolean;
  enabled?: boolean;
}

export interface ModelRow {
  id: string;
  model_number: number | null;
  model_type: string | null;
  active: boolean;
  enabled: boolean;
}

export interface PartSummaryRow {
  id: string;
  number: string;
  revision: string;
  model_id: string | null;
  model?: ModelRow | null;
  hos: string | null;
  active: boolean;
  enabled: boolean;
}

export interface PartTypeRow {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
}

export interface PartRow {
  id: string;
  part_number: string;
  summary_id: string;
  part_type_id: string;
  teeth: number | null;
  active: boolean;
  enabled: boolean;
  roll_master?: RollMasterRow | null;
  summary?: PartSummaryRow;
  part_type?: PartTypeRow;
}

export interface DepartmentRow {
  id: string;
  code: string;
  description: string;
  active: boolean;
  enabled: boolean;
}

export interface MachineRow {
  id: string;
  machine_number: string;
  department_id: string;
  department?: DepartmentRow;
  cell: number | null;
  description?: string | null;
  machine_type: 'PRODUCTION' | 'CUTTER_BUILDER' | 'GRINDER' | string;
  active: boolean;
  enabled: boolean;
}

export interface CutterBodyRow {
  id: string;
  mf_serial_number: string | null;
  dana_serial_number?: string | null;
  description?: string | null;
  enabled: boolean;
}

export interface RollMasterRow {
  id: string;
  part_id: string;
  required_count: number;
  current_quantity: number;
  minimum_quantity: number;
  active: boolean;
  enabled: boolean;
  notes: string | null;
}

export interface AdminLocationRow {
  id: string;
  serial_number: string;
  number: string;
  description: string | null;
  department: string | null;
  location_type: string;
  enabled: boolean;
  tray_count: number;
  blade_count: number;
  /** What the location holds, printed on its summary tag. */
  summary_id?: string | null;
  summary?: { id: string; number: string; revision?: string } | null;
  part_type_id?: string | null;
  part_type?: { id: string; code: string } | null;
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly printerChoice = inject(LabelPrinterChoiceService);

  listUsers(page: number, perPage = 50) {
    return this.http.get<PagedResponse<AdminUser>>(
      `/api/v1/users?perPage=${perPage}&page=${page}`,
    );
  }

  createUser(input: {
    email: string;
    password: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    departmentId: string;
  }) {
    return this.http.post<AdminUser>('/api/v1/users', input);
  }

  updateUser(id: string, input: Partial<Pick<AdminUser, 'email' | 'firstName' | 'lastName' | 'role' | 'departmentId' | 'active'>>) {
    return this.http.patch<AdminUser>(`/api/v1/users/${encodeURIComponent(id)}`, input);
  }

  listPartSummaries(page: number, perPage = 50) {
    return this.http.get<PagedResponse<PartSummaryRow>>(
      `/api/v1/part-summaries?perPage=${perPage}&page=${page}`,
    );
  }

  createPartSummary(input: {
    number: string;
    revision: string;
    model_id: string | null;
    hos: string | null;
    active: boolean;
    enabled: boolean;
  }) {
    return this.http.post<PartSummaryRow>('/api/v1/part-summaries', input);
  }

  updatePartSummary(id: string, input: Partial<{
    number: string;
    revision: string;
    model_id: string | null;
    hos: string | null;
    active: boolean;
    enabled: boolean;
  }>) {
    return this.http.patch<PartSummaryRow>(`/api/v1/part-summaries/${encodeURIComponent(id)}`, input);
  }

  listPartTypes() {
    return this.http.get<PartTypeRow[]>('/api/v1/cutter-config/part-types');
  }

  listParts() {
    return this.http.get<PartRow[]>('/api/v1/parts?active=ALL&includeDisabled=true');
  }

  createPart(input: {
    part_number: string;
    summary_id: string;
    part_type_id: string;
    teeth: number | null;
    active: boolean;
    enabled: boolean;
  }) {
    return this.http.post<PartRow>('/api/v1/parts', input);
  }

  updatePart(id: string, input: Partial<{
    part_number: string;
    summary_id: string;
    part_type_id: string;
    teeth: number | null;
    active: boolean;
    enabled: boolean;
  }>) {
    return this.http.patch<PartRow>(`/api/v1/parts/${encodeURIComponent(id)}`, input);
  }

  listRollMasters() {
    return this.http.get<RollMasterRow[]>('/api/v1/roll-masters?active=ALL&includeDisabled=true');
  }

  createRollMaster(input: { part_id: string; current_quantity: number; minimum_quantity: number; active: boolean; enabled: boolean; notes?: string | null }) {
    return this.http.post<RollMasterRow>('/api/v1/roll-masters', input);
  }

  updateRollMaster(id: string, input: Partial<{ current_quantity: number; minimum_quantity: number; active: boolean; enabled: boolean; notes: string | null }>) {
    return this.http.patch<RollMasterRow>(`/api/v1/roll-masters/${encodeURIComponent(id)}`, input);
  }

  listModels() {
    return this.http.get<ModelRow[]>('/api/v1/admin/master-data/models');
  }

  createModel(input: {
    model_number: number | null;
    model_type: string | null;
    active: boolean;
  }) {
    return this.http.post<ModelRow>('/api/v1/admin/master-data/models', input);
  }

  updateModel(id: string, input: Partial<{ model_number: number | null; model_type: string | null; active: boolean; enabled: boolean }>) {
    return this.http.patch<ModelRow>(`/api/v1/admin/master-data/models/${encodeURIComponent(id)}`, input);
  }

  listDepartments() {
    return this.http.get<DepartmentRow[]>(
      '/api/v1/admin/master-data/departments',
    );
  }

  listMachines() {
    return this.http.get<MachineRow[]>('/api/v1/admin/master-data/machines');
  }

  createMachine(input: {
    machine_number: string;
    department_id: string;
    cell: number | null;
    description: string | null;
    machine_type: 'PRODUCTION' | 'CUTTER_BUILDER' | 'GRINDER';
    active: boolean;
  }) {
    return this.http.post<MachineRow>(
      '/api/v1/admin/master-data/machines',
      input,
    );
  }


  updateMachine(id: string, input: Partial<{
    machine_number: string;
    department_id: string;
    cell: number | null;
    description: string | null;
    machine_type: 'PRODUCTION' | 'CUTTER_BUILDER' | 'GRINDER';
    active: boolean;
    enabled: boolean;
  }>) {
    return this.http.patch<MachineRow>(`/api/v1/admin/master-data/machines/${encodeURIComponent(id)}`, input);
  }

  listLocations(page: number, perPage = 50) {
    return this.http.get<PagedResponse<AdminLocationRow>>(
      `/api/v1/locations?perPage=${perPage}&page=${page}`,
    );
  }

  listTrays(page: number, perPage = 50) {
    return this.http.get<PagedResponse<AdminTrayRow>>(
      `/api/v1/trays?perPage=${perPage}&page=${page}`,
    );
  }

  createTray(input: {
    serial_number: string;
    blade_count?: number;
    enabled?: boolean;
  }) {
    return this.http.post<AdminTrayRow>('/api/v1/trays', input);
  }


  updateTray(id: string, input: Partial<{ serial_number: string; enabled: boolean }>) {
    return this.http.patch<AdminTrayRow>(`/api/v1/trays/${encodeURIComponent(id)}`, input);
  }

  createContainer(input: { serial_number: string; enabled: boolean }) {
    return this.http.post<AdminContainerRow>('/api/v1/containers', input);
  }


  updateContainer(id: string, input: Partial<{ serial_number: string; enabled: boolean }>) {
    return this.http.patch<AdminContainerRow>(`/api/v1/containers/${encodeURIComponent(id)}`, input);
  }

  listContainers(page: number, perPage = 50) {
    return this.http.get<PagedResponse<AdminContainerRow>>(
      `/api/v1/containers?perPage=${perPage}&page=${page}`,
    );
  }

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

  createLocation(input: {
    serial_number: string;
    number: string;
    description: string | null;
    department: string | null;
    location_type: string;
    enabled: boolean;
    summary_id?: string | null;
    part_type_id?: string | null;
  }) {
    return this.http.post<AdminLocationRow>('/api/v1/locations', input);
  }

  /** Every bin of one Cuttergrind shelf; barcodes that already exist are left as they are. */
  bulkCreateShelfLocations(input: IBulkCreateShelfLocations) {
    return this.http.post<IBulkShelfLocationsResult>('/api/v1/locations/bulk-shelves', input);
  }

  updateLocation(
    id: string,
    input: Partial<{
      serial_number: string;
      number: string;
      description: string | null;
      department: string | null;
      location_type: string;
      enabled: boolean;
      summary_id: string | null;
      part_type_id: string | null;
    }>,
  ) {
    return this.http.patch<AdminLocationRow>(
      `/api/v1/locations/${encodeURIComponent(id)}`,
      input,
    );
  }

  listCutterBodies() {
    return this.http.get<CutterBodyRow[]>('/api/v1/cutter-builder/cutter-bodies/admin');
  }

  createCutterBody(input: {
    mf_serial_number: string;
    dana_serial_number: string | null;
    description: string | null;
  }) {
    return this.http.post<CutterBodyRow>(
      '/api/v1/cutter-builder/cutter-bodies',
      input,
    );
  }


  updateCutterBody(id: string, input: Partial<{
    mf_serial_number: string | null;
    dana_serial_number: string | null;
    description: string | null;
    enabled: boolean;
  }>) {
    return this.http.patch<CutterBodyRow>(`/api/v1/cutter-builder/cutter-bodies/${encodeURIComponent(id)}`, input);
  }

  assignCutterBodyDanaSerial(id: string, danaSerialNumber: string) {
    return this.http.patch<CutterBodyRow>(
      `/api/v1/cutter-builder/cutter-bodies/${encodeURIComponent(id)}/dana-serial`,
      { dana_serial_number: danaSerialNumber.trim().toUpperCase() },
    );
  }
}

export function adminApiErrorText(error: HttpErrorResponse): string {
  const message = error.error?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string' && message.trim()) return message;
  if (error.status === 403) return 'Admin access is required for this screen.';
  return `Request failed${error.status ? ` (${error.status})` : ''}.`;
}
