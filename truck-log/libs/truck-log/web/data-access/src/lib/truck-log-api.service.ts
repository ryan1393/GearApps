import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { timeout } from 'rxjs';
import type {
  DockScanLookup,
  DockDeliveryScanReceipt,
  CarrierReferenceRecord,
  CheckInConfigRecord,
  CheckInReferenceData,
  CreateTruckVisitRequest,
  DashboardData,
  DriverPrintPackageRecord,
  DockAgingSettingsRecord,
  DockRecord,
  DriverReferenceRecord,
  HealthData,
  LocationReferenceRecord,
  PackingSlipRouteConfig,
  PackingSlipRouteUpdateRequest,
  RxoControlStatusData,
  RxoDataPage,
  RxoExporterSettings,
  RxoFreightRecord,
  RxoImportStatusData,
  RxoManualRunState,
  RxoOrderRecord,
  RxoDirection,
  RxoDriverDocumentSummary,
  RxoShipmentRecord,
  ScheduledLoadImportResult,
  ScheduledLoadLookupRecord,
  ScheduledLoadRecord,
  TruckVisitRecord,
  VisitDocumentRecord,
} from '@truck-log/shared/contracts';

@Injectable({ providedIn: 'root' })
export class TruckLogApi {
  private readonly base = '/api/v1';

  constructor(private readonly http: HttpClient) {}

  newIdempotencyKey() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  health() {
    return this.http.get<HealthData>(`${this.base}/health`);
  }

  healthLive() {
    return this.http.get<{
      status: string;
      application: string;
      version: string;
      time: string;
    }>(`${this.base}/health/live`);
  }

  dashboard() {
    return this.http.get<DashboardData>(`${this.base}/visits/dashboard`);
  }

  active(q = '') {
    return this.http.get<TruckVisitRecord[]>(`${this.base}/visits`, {
      params: q ? new HttpParams().set('q', q) : undefined,
    });
  }

  records(q = '', status = 'ALL', date = '') {
    let params = new HttpParams();
    if (q.trim()) params = params.set('q', q.trim());
    if (status && status !== 'ALL') params = params.set('status', status);
    if (date) params = params.set('date', date);
    params = params.set('limit', '250');
    return this.http.get<TruckVisitRecord[]>(`${this.base}/visits/history`, { params });
  }

  history(q = '') {
    return this.records(q, 'GUARD_CHECKED_OUT');
  }

  visit(id: number) {
    return this.http.get<TruckVisitRecord>(`${this.base}/visits/${id}`);
  }

  dockBoard(refreshKey?: string) {
    const suffix = refreshKey ? '?_refresh=' + encodeURIComponent(refreshKey) : '';
    return this.http.get<TruckVisitRecord[]>(`${this.base}/visits/dock-board${suffix}`);
  }

  docks() {
    return this.http.get<DockRecord[]>(`${this.base}/docks`);
  }

  checkInConfig() {
    return this.http.get<CheckInConfigRecord>(`${this.base}/visits/check-in-config`).pipe(timeout(10000));
  }

  checkInReferenceData() {
    return this.http.get<CheckInReferenceData>(`${this.base}/reference-data/check-in`);
  }

  drivers(includeInactive = true) {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return this.http.get<DriverReferenceRecord[]>(`${this.base}/reference-data/drivers`, { params });
  }

  createDriver(payload: { name: string; phoneNumber?: string }) {
    return this.http.post<DriverReferenceRecord>(`${this.base}/reference-data/drivers`, payload);
  }

  updateDriver(id: number, payload: Partial<Pick<DriverReferenceRecord, 'name' | 'phoneNumber' | 'active'>>) {
    return this.http.patch<DriverReferenceRecord>(`${this.base}/reference-data/drivers/${id}`, payload);
  }

  carriers(includeInactive = true) {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return this.http.get<CarrierReferenceRecord[]>(`${this.base}/reference-data/carriers`, { params });
  }

  createCarrier(payload: { name: string }) {
    return this.http.post<CarrierReferenceRecord>(`${this.base}/reference-data/carriers`, payload);
  }

  updateCarrier(id: number, payload: Partial<Pick<CarrierReferenceRecord, 'name' | 'active'>>) {
    return this.http.patch<CarrierReferenceRecord>(`${this.base}/reference-data/carriers/${id}`, payload);
  }

  locations(includeInactive = true) {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return this.http.get<LocationReferenceRecord[]>(`${this.base}/reference-data/locations`, { params });
  }

  createLocation(payload: {
    name: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }) {
    return this.http.post<LocationReferenceRecord>(`${this.base}/reference-data/locations`, payload);
  }

  updateLocation(id: number, payload: Partial<Pick<LocationReferenceRecord,
    'name' | 'addressLine1' | 'city' | 'state' | 'postalCode' | 'country' | 'active'>>) {
    return this.http.patch<LocationReferenceRecord>(`${this.base}/reference-data/locations/${id}`, payload);
  }

  gatePrintingSettings() {
    return this.http.get<{ eastPrinter: string; westPrinter: string }>(`${this.base}/settings/gate-printing`);
  }
  updateGatePrintingSettings(payload: { eastPrinter: string; westPrinter: string }) {
    return this.http.patch<{ eastPrinter: string; westPrinter: string }>(`${this.base}/settings/gate-printing`, payload);
  }

  /** SAP packing-slip watcher routes (Administration > Printing). */
  packingSlipRoutes() {
    return this.http.get<PackingSlipRouteConfig>(`${this.base}/admin/packing-slip-routes`);
  }
  updatePackingSlipRoutes(payload: PackingSlipRouteUpdateRequest) {
    return this.http.put<PackingSlipRouteConfig>(`${this.base}/admin/packing-slip-routes`, payload);
  }

  dockAgingSettings() {
    return this.http.get<DockAgingSettingsRecord>(`${this.base}/settings/dock-aging`);
  }

  updateDockAgingSettings(payload: DockAgingSettingsRecord) {
    return this.http.patch<DockAgingSettingsRecord>(`${this.base}/settings/dock-aging`, payload);
  }

  rxoStatus() {
    return this.http.get<RxoImportStatusData>(`${this.base}/rxo/status`);
  }

  rxoControl() {
    return this.http.get<RxoControlStatusData>(`${this.base}/rxo/control`);
  }

  updateRxoSettings(payload: RxoExporterSettings) {
    return this.http.patch<RxoExporterSettings>(`${this.base}/rxo/control/settings`, payload);
  }

  updateRxoCredentials(payload: { username: string; password?: string }) {
    return this.http.put<{ username: string; usernameConfigured: boolean; passwordConfigured: boolean; passwordUpdated: boolean }>(
      `${this.base}/rxo/control/credentials`, payload,
    );
  }

  runRxoScanNow() {
    return this.http.post<RxoManualRunState>(`${this.base}/rxo/control/rescan`, {});
  }

  syncRxoLatestNow() {
    return this.http.post<RxoManualRunState>(`${this.base}/rxo/control/sync-latest`, {});
  }

  rxoData<T extends RxoOrderRecord | RxoShipmentRecord | RxoFreightRecord>(
    kind: 'orders' | 'shipments' | 'freight',
    options: { direction?: string; q?: string; page?: number; pageSize?: number } = {},
  ) {
    let params = new HttpParams()
      .set('kind', kind)
      .set('site', 'fort-wayne')
      .set('page', String(options.page ?? 1))
      .set('pageSize', String(options.pageSize ?? 100));
    if (options.direction) params = params.set('direction', options.direction);
    if (options.q?.trim()) params = params.set('q', options.q.trim());
    return this.http.get<RxoDataPage<T>>(`${this.base}/rxo/data`, { params });
  }

  rxoDriverDocument(
    siteKey: string,
    direction: RxoDirection,
    shipmentId: string,
    accessToken: string,
  ) {
    return this.http.get<RxoDriverDocumentSummary>(
      this.rxoDriverDocumentPath(siteKey, direction, shipmentId),
      { headers: new HttpHeaders().set('Authorization', `Bearer ${accessToken.trim()}`) },
    );
  }

  uploadRxoDriverDocument(
    siteKey: string,
    direction: RxoDirection,
    shipmentId: string,
    file: File,
    accessToken: string,
    idempotencyKey: string,
  ) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<RxoDriverDocumentSummary>(
      this.rxoDriverDocumentPath(siteKey, direction, shipmentId),
      form,
      { headers: this.authorizedIdempotencyHeaders(accessToken, idempotencyKey) },
    );
  }

  /** Interactive Materials upload: no credential entry or browser-stored secret. */
  uploadRxoDriverDocumentFromBrowser(
    siteKey: string,
    direction: RxoDirection,
    shipmentId: string,
    file: File,
    idempotencyKey: string,
  ) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<RxoDriverDocumentSummary>(
      `${this.rxoDriverDocumentPath(siteKey, direction, shipmentId)}/browser-upload`,
      form,
      {
        headers: new HttpHeaders()
          // A non-secret request marker, not a token or password. The browser
          // supplies Origin; the server checks the app origin before buffering.
          .set('X-Truck-Log-Upload', 'browser-v1')
          .set('X-Idempotency-Key', idempotencyKey),
      },
    );
  }

  rxoExpediteCheckInLoads() {
    return this.http.get<{ rows: RxoFreightRecord[]; unselectableCount: number; sourceBatchId: string | null }>(`${this.base}/rxo/expedite/check-in-loads`);
  }

  scheduledLoad(loadNumber: string) {
    return this.http.get<ScheduledLoadLookupRecord>(`${this.base}/scheduled-loads/lookup`, {
      params: new HttpParams().set('loadNumber', loadNumber.trim()),
    });
  }

  scheduledLoads() {
    return this.http.get<ScheduledLoadRecord[]>(`${this.base}/scheduled-loads`);
  }

  scheduledLoadsTemplateUrl() {
    return `${this.base}/scheduled-loads/template`;
  }

  importScheduledLoads(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ScheduledLoadImportResult>(`${this.base}/scheduled-loads/import`, form);
  }

  createDock(payload: Partial<DockRecord> & { code: string }) {
    return this.http.post<DockRecord>(`${this.base}/docks`, payload);
  }

  setDockActive(id: number, active: boolean) {
    return this.http.patch<DockRecord>(`${this.base}/docks/${id}/active`, { active });
  }

  createVisit(payload: CreateTruckVisitRequest) {
    return this.http.post<TruckVisitRecord>(`${this.base}/visits`, payload);
  }

  driverPrintPackage(visitId: number) {
    return this.http.get<DriverPrintPackageRecord | null>(
      `${this.base}/visits/${visitId}/driver-print-package`,
    );
  }

  driverPrintPackageById(packageId: string) {
    return this.http.get<DriverPrintPackageRecord>(
      `${this.base}/driver-print/packages/${encodeURIComponent(packageId.trim())}`,
    );
  }

  confirmDockAssignmentPrint(
    packageId: string,
    status: 'PRINTED' | 'FAILED',
    idempotencyKey: string,
    guardActionKey: string,
    error?: string,
  ) {
    const encodedPackageId = encodeURIComponent(packageId.trim());
    return this.http.post<DriverPrintPackageRecord>(
      `${this.base}/driver-print/packages/${encodedPackageId}/dock-result`,
      { status, error: error?.trim() || undefined },
      { headers: this.idempotencyHeaders(idempotencyKey).set('X-Guard-Action-Key', guardActionKey.trim()) },
    );
  }

  retryRxoDriverDocument(packageId: string, idempotencyKey: string, guardActionKey: string) {
    const encodedPackageId = encodeURIComponent(packageId.trim());
    return this.http.post<DriverPrintPackageRecord>(
      `${this.base}/driver-print/packages/${encodedPackageId}/retry-rxo`,
      {},
      { headers: this.idempotencyHeaders(idempotencyKey).set('X-Guard-Action-Key', guardActionKey.trim()) },
    );
  }

  retryDockAssignmentPrint(packageId: string, idempotencyKey: string, guardActionKey: string) {
    const encodedPackageId = encodeURIComponent(packageId.trim());
    return this.http.post<DriverPrintPackageRecord>(
      `${this.base}/driver-print/packages/${encodedPackageId}/retry-dock`,
      {},
      { headers: this.idempotencyHeaders(idempotencyKey).set('X-Guard-Action-Key', guardActionKey.trim()) },
    );
  }

  recoverQueuedPrint(
    packageId: string,
    payload: { itemType: 'DOCK_ASSIGNMENT' | 'RXO_DOCUMENT'; action: 'CANCEL' | 'REPLACE'; reason: string; gate?: 'EAST' | 'WEST' },
    idempotencyKey: string,
    guardActionKey: string,
  ) {
    return this.http.post<DriverPrintPackageRecord>(
      `${this.base}/driver-print/packages/${encodeURIComponent(packageId.trim())}/recover-queued`,
      payload,
      { headers: this.idempotencyHeaders(idempotencyKey).set('X-Guard-Action-Key', guardActionKey.trim()) },
    ).pipe(timeout(20000));
  }

  reprintRxoDriverDocument(
    visitId: number,
    documentId: number,
    accessToken: string,
    idempotencyKey: string,
  ) {
    return this.http.post<DriverPrintPackageRecord>(
      `${this.base}/driver-print/visits/${visitId}/reprint-rxo`,
      { documentId },
      { headers: this.authorizedIdempotencyHeaders(accessToken, idempotencyKey) },
    );
  }

  downloadRxoDriverDocument(documentId: number, accessToken: string) {
    return this.http.get(
      `${this.base}/rxo-documents/${documentId}/download`,
      {
        headers: new HttpHeaders().set('Authorization', `Bearer ${accessToken.trim()}`),
        responseType: 'blob',
      },
    );
  }

  markDockComplete(id: number, actor = 'Dock') {
    return this.http.patch<TruckVisitRecord>(`${this.base}/visits/${id}/dock-complete`, { actor });
  }

  finalCheckout(id: number, actor = 'Guard', printProof?: string) {
    return this.http.patch<TruckVisitRecord>(`${this.base}/visits/${id}/final-checkout`, {
      actor, ...(printProof ? { printProof } : {}),
    });
  }

  uploadDocument(id: number, file: File, actor = 'Guard') {
    const form = new FormData();
    form.append('file', file);
    form.append('actor', actor);
    form.append('documentType', 'DRIVER_PAPERWORK');
    return this.http.post<VisitDocumentRecord>(`${this.base}/visits/${id}/documents`, form);
  }

  saveManualDeliveryNumber(id: number, deliveryNumber: string) {
    return this.http.post<DockDeliveryScanReceipt>(`${this.base}/visits/${id}/delivery-number/manual`, { deliveryNumber });
  }

  saveScannedDeliveryNumber(id: number, deliveryNumber: string) {
    return this.http.post<DockDeliveryScanReceipt>(`${this.base}/visits/${id}/delivery-number/scan`, { deliveryNumber });
  }

  scanPackingSlip(id: number, deliveryNumber: string) {
    return this.http.post<DockScanLookup>(`${this.base}/visits/${id}/packing-slip/scan`, { deliveryNumber });
  }

  previewScannedPackingSlip(id: number, token: string) {
    return this.http.post(`${this.base}/visits/${id}/packing-slip/scan/preview`, { token },
      { responseType: 'blob', observe: 'response' });
  }

  attachScannedPackingSlip(id: number, token: string) {
    return this.http.post<VisitDocumentRecord>(`${this.base}/visits/${id}/packing-slip/scan/attach`, { token });
  }

  documentBlob(documentId: number) {
    return this.http.get(this.documentUrl(documentId), { responseType: 'blob', observe: 'response' });
  }

  uploadPackingSlip(id: number, file: File, actor = 'Dock') {
    const form = new FormData();
    form.append('file', file);
    form.append('actor', actor);
    return this.http.post<VisitDocumentRecord>(`${this.base}/visits/${id}/packing-slip`, form);
  }

  slipUrl(id: number) {
    return `${this.base}/visits/${id}/slip`;
  }

  documentUrl(documentId: number) {
    return `${this.base}/visits/documents/${documentId}/download`;
  }

  private rxoDriverDocumentPath(siteKey: string, direction: RxoDirection, shipmentId: string) {
    const segments = [siteKey, direction, shipmentId].map((value) => encodeURIComponent(value.trim()));
    return `${this.base}/rxo-documents/${segments.join('/')}`;
  }

  private idempotencyHeaders(idempotencyKey: string) {
    return new HttpHeaders().set('X-Idempotency-Key', idempotencyKey.trim());
  }

  private authorizedIdempotencyHeaders(accessToken: string, idempotencyKey: string) {
    return this.idempotencyHeaders(idempotencyKey)
      .set('Authorization', `Bearer ${accessToken.trim()}`);
  }
}
