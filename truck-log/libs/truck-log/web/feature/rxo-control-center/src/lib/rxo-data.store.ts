import { Injectable, OnDestroy } from '@angular/core';
import type {
  RxoDataPage,
  RxoFreightRecord,
  RxoOrderRecord,
  RxoShipmentRecord,
} from '@truck-log/shared/contracts';
import { TruckLogApi, UploadIdempotency, pdfUploadValidationError } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';
import * as rxoPresenter from './rxo-control-center.presenter';

export type DataKind = 'orders' | 'shipments' | 'freight';
export type RxoRow = RxoOrderRecord | RxoShipmentRecord | RxoFreightRecord;

/**
 * RXO Data tab state and actions. Provided by the Control Center so the chosen
 * dataset, filters, page and open details survive switching to another tab
 * (the table view itself is only rendered while the Data tab is open).
 */
@Injectable()
export class RxoDataStore implements OnDestroy {
  dataKind: DataKind = 'orders';
  dataSearch = '';
  dataDirection = '';
  currentPage = 1;
  readonly pageSize = 100;
  dataPage: RxoDataPage<RxoRow> | null = null;
  dataLoading = false;
  documentUploadTarget: RxoShipmentRecord | null = null;
  documentUploadingKey = '';
  private readonly uploadIdempotency = new UploadIdempotency();

  // RXO row details
  // Selection uses the complete RXO identity, never the row number or shipment ID alone.
  expandedRxoRowKey = '';
  rxoDataError = '';
  private rxoDataRequestId = 0;
  private rxoDataDestroyed = false;
  private rxoDataViewKey = '';
  private rxoOrderLocationNames: Record<string, string> = {};
  private rxoOrderLocationLookupId = 0;
  private rxoOrderLocationNamesLoadedAt = 0;

  constructor(private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  ngOnDestroy() {
    this.rxoDataDestroyed = true;
    ++this.rxoDataRequestId; // Late data responses must not update a destroyed view.
  }

  /** Idempotency key kept for retrying the same PDF after a network failure. */
  get pendingDocumentUploadKey() { return this.uploadIdempotency.key; }

  get dataKindLabel() { return this.dataKind === 'orders' ? 'Orders' : this.dataKind === 'shipments' ? 'Shipments' : 'Freight records'; }
  get totalPages() { return Math.max(1, Math.ceil((this.dataPage?.total ?? 0) / this.pageSize)); }
  get dataRangeStart() {
    const total = this.dataPage?.total ?? 0;
    return total ? ((this.dataPage?.page ?? 1) - 1) * (this.dataPage?.pageSize ?? this.pageSize) + 1 : 0;
  }
  get dataRangeEnd() {
    const total = this.dataPage?.total ?? 0;
    return Math.min(total, (this.dataPage?.page ?? 1) * (this.dataPage?.pageSize ?? this.pageSize));
  }

  rxoDataRowKey(kind: DataKind, row: RxoRow): string {
    const id = kind === 'orders' ? (row as RxoOrderRecord).order_number : (row as RxoShipmentRecord).shipment_id;
    return JSON.stringify([kind, row.site_key, row.direction, id]);
  }

  readonly trackRxoDataRow = (_index: number, row: RxoRow): string => this.rxoDataRowKey(this.dataKind, row);

  rxoDetailsId(kind: DataKind, row: RxoRow): string {
    return 'rxo-details-' + encodeURIComponent(this.rxoDataRowKey(kind, row));
  }

  rxoDetailsOpen(kind: DataKind, row: RxoRow): boolean {
    return this.expandedRxoRowKey === this.rxoDataRowKey(kind, row);
  }

  toggleRxoDetails(kind: DataKind, row: RxoRow): void {
    const key = this.rxoDataRowKey(kind, row);
    this.expandedRxoRowKey = this.expandedRxoRowKey === key ? '' : key;
  }

  closeRxoDetails(kind: DataKind, row: RxoRow, event: Event): void {
    if (!this.rxoDetailsOpen(kind, row)) return;
    event.preventDefault();
    event.stopPropagation();
    this.expandedRxoRowKey = '';
    document.getElementById(this.rxoDetailsId(kind, row) + '-toggle')?.focus();
  }

  retryRxoData(): void { this.loadData(); }

  changeKind(kind: DataKind) { this.dataKind = kind; this.currentPage = 1; this.loadData(); }
  applyDataFilters() { this.currentPage = 1; this.loadData(); }
  clearDataFilters() { this.dataSearch = ''; this.dataDirection = ''; this.currentPage = 1; this.loadData(); }
  goPage(page: number) { this.currentPage = Math.min(Math.max(page, 1), this.totalPages); this.loadData(); }

  loadData() {
    if (this.rxoDataDestroyed) return;
    // Keep the same endpoint, filters and paging, but accept only the newest response.
    const requestId = ++this.rxoDataRequestId;
    const kind = this.dataKind;
    if (kind !== 'orders') this.loadRxoOrderLocationNames();
    const query = { q: this.dataSearch, direction: this.dataDirection, page: this.currentPage, pageSize: this.pageSize };
    const viewKey = JSON.stringify([kind, query.q, query.direction, query.page, query.pageSize]);
    if (viewKey !== this.rxoDataViewKey) this.expandedRxoRowKey = '';
    this.rxoDataViewKey = viewKey;
    this.dataLoading = true;
    this.rxoDataError = '';
    this.dataPage = null; // Do not present previous-filter rows as the requested dataset.
    this.api.rxoData<RxoRow>(kind, query).subscribe({
      next: (page) => {
        if (requestId !== this.rxoDataRequestId) return;
        this.dataLoading = false;
        if (page.kind !== kind) {
          this.rxoDataError = 'RXO returned a different dataset. Retry to load the selected results.';
          return;
        }
        this.dataPage = page;
        if (!page.rows.some((row) => this.rxoDataRowKey(kind, row) === this.expandedRxoRowKey)) this.expandedRxoRowKey = '';
      },
      error: (error) => {
        if (requestId !== this.rxoDataRequestId) return;
        this.dataLoading = false;
        this.rxoDataError = error?.error?.message || 'Could not load RXO data. Retry the current search.';
        this.toast.error(this.rxoDataError);
      },
    });
  }

  /** Order-derived short names for Shipment / Freight stop addresses (refreshed at most every 30 s). */
  loadRxoOrderLocationNames(force = false): void {
    if (this.rxoDataDestroyed) return;
    if (
      !force
      && this.rxoOrderLocationNamesLoadedAt
      && Date.now() - this.rxoOrderLocationNamesLoadedAt < 30_000
    ) return;

    const requestId = ++this.rxoOrderLocationLookupId;
    const pageSize = 100;
    const grouped = new Map<string, Set<string>>();

    const addLocation = (
      address: string | null | undefined,
      name: string | null | undefined,
    ) => {
      const key = rxoPresenter.normalizeLocationAddress(address);
      const shortName = String(name ?? '').trim();
      if (!key || !shortName) return;
      const names = grouped.get(key) ?? new Set<string>();
      names.add(shortName);
      grouped.set(key, names);
    };

    const mergePage = (rows: RxoOrderRecord[]) => {
      for (const row of rows) {
        addLocation(row.origin_address, row.origin_name);
        addLocation(row.destination_address, row.destination_name);
      }
    };

    const finish = () => {
      if (requestId !== this.rxoOrderLocationLookupId || this.rxoDataDestroyed) return;
      const next: Record<string, string> = {};
      for (const [address, names] of grouped) {
        // Only use an Order-derived address label when Orders agree on one short name.
        if (names.size === 1) next[address] = [...names][0];
      }
      this.rxoOrderLocationNames = next;
      this.rxoOrderLocationNamesLoadedAt = Date.now();
    };

    const loadPage = (page: number) => {
      this.api.rxoData<RxoOrderRecord>('orders', {
        q: '',
        direction: '',
        page,
        pageSize,
      }).subscribe({
        next: (result) => {
          if (requestId !== this.rxoOrderLocationLookupId || this.rxoDataDestroyed) return;
          mergePage(result.rows ?? []);
          if (page * pageSize < Number(result.total ?? 0)) loadPage(page + 1);
          else finish();
        },
        error: () => {
          if (requestId !== this.rxoOrderLocationLookupId || this.rxoDataDestroyed) return;
          this.rxoOrderLocationNamesLoadedAt = Date.now();
        },
      });
    };

    loadPage(1);
  }

  rxoCanonicalShortRouteName(row: RxoShipmentRecord | RxoFreightRecord): string {
    return rxoPresenter.canonicalShortRouteName(row, this.rxoOrderLocationNames);
  }

  rxoShipmentKey(row: RxoShipmentRecord) {
    return [row.site_key, row.direction, row.shipment_id]
      .map((value) => encodeURIComponent(String(value || '').trim()))
      .join('|');
  }

  hasRxoDriverDocument(row: RxoShipmentRecord) {
    return Boolean(row.driverDocument && row.driverDocument.status !== 'NO_DOCUMENT');
  }

  driverDocumentStatusLabel(row: RxoShipmentRecord) {
    const labels = {
      NO_DOCUMENT: 'No Documents',
      READY: 'Documents Ready',
      PRINTING: 'Printing',
      PRINTED: 'Printed to Driver',
      PRINT_FAILED: 'Print Failed',
    } as const;
    return labels[row.driverDocument?.status ?? 'NO_DOCUMENT'];
  }

  driverDocumentTone(row: RxoShipmentRecord): 'success' | 'info' | 'danger' | 'neutral' {
    const status = row.driverDocument?.status ?? 'NO_DOCUMENT';
    if (status === 'PRINTED') return 'success';
    if (status === 'READY' || status === 'PRINTING') return 'info';
    if (status === 'PRINT_FAILED') return 'danger';
    return 'neutral';
  }

  beginRxoDocumentUpload(row: RxoShipmentRecord, input: HTMLInputElement) {
    if (this.documentUploadingKey) return;
    this.documentUploadTarget = row;
    input.value = '';
    input.click();
  }

  async uploadRxoDriverDocument(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    const target = this.documentUploadTarget;
    if (!file || !target || this.documentUploadingKey) return;

    if (this.hasRxoDriverDocument(target) && !window.confirm(
      `Replace the active driver document for RXO shipment ${target.shipment_id}? The current version will remain in audit history.`,
    )) {
      this.documentUploadTarget = null;
      return;
    }

    const uploadKey = this.rxoShipmentKey(target);
    this.documentUploadingKey = uploadKey;
    const invalidReason = await pdfUploadValidationError(file, 'RXO driver documents');
    if (invalidReason) {
      this.documentUploadingKey = '';
      this.documentUploadTarget = null;
      this.toast.error(invalidReason, 'RXO document not uploaded');
      return;
    }

    const idempotencyKey = this.uploadIdempotency.keyFor(uploadKey, file, () => this.api.newIdempotencyKey());

    this.api.uploadRxoDriverDocumentFromBrowser(
      target.site_key,
      target.direction,
      target.shipment_id,
      file,
      idempotencyKey,
    ).subscribe({
      next: (document) => {
        this.uploadIdempotency.clear();
        this.documentUploadingKey = '';
        this.documentUploadTarget = null;
        this.toast.success(
          `${document.fileName || file.name} is the active driver document${document.version ? ` (version ${document.version})` : ''}.`,
          this.hasRxoDriverDocument(target) ? 'RXO document replaced' : 'RXO document uploaded',
        );
        this.loadData();
      },
      error: (response) => {
        this.documentUploadingKey = '';
        this.documentUploadTarget = null;
        this.uploadIdempotency.failed(Number(response?.status ?? 0));
        this.toast.error(response?.error?.message || 'Could not upload the RXO driver document.', 'RXO document upload failed');
      },
    });
  }
}
