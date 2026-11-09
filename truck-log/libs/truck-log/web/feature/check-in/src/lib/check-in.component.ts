import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TruckLogApi } from '@truck-log/web/data-access';
import { CarrierReferenceRecord, CheckInConfigRecord, DriverReferenceRecord, DockRecord, LocationReferenceRecord, RxoFreightRecord, ScheduledLoadLookupRecord, TruckVisitRecord } from '@truck-log/shared/contracts';
import { CheckInForm, CheckInRxoSelection, UppercaseCheckInField, emptyCheckInForm, toCreateTruckVisitRequest } from '@truck-log/web/domain';
import { ToastService } from '@truck-log/web/ui';
import { DanaComboboxComponent, type DanaComboboxColumn } from '@dana/ui';
import { DockStatusWidgetComponent } from './dock-status-widget.component';
import { DriverPrintTracker } from './driver-print-tracker.service';
import { FreightLoadPicker } from './freight-load-picker.service';


@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, DockStatusWidgetComponent, DanaComboboxComponent],
  // Load picker and print-package tracking are scoped to this page.
  providers: [FreightLoadPicker, DriverPrintTracker],
  templateUrl: './check-in.component.html'
})
/**
 * Operator-side coordinator for check-in state, lookups, validation and submit.
 *
 * The HTML lives beside this file and pure request shaping/defaults live in the
 * check-in domain helpers. Keep display-only markup out of this class and keep
 * server-authoritative workflow validation on the API side.
 */
export class CheckInComponent implements OnInit, OnDestroy {
  docks: DockRecord[] = [];
  activeDocks: DockRecord[] = [];
  docksLoaded = false;
  files: File[] = [];
  retryFiles: File[] = [];
  saving = false;
  printingConfigLoading = true;
  printingUnavailableReason = '';
  printMode: 'AUTOMATIC' | 'MANUAL' = 'MANUAL';
  private printModeEdited = false;
  lastCheckInManualPrinting = false;
  printWindow: Window | null = null;
  visitLocked = false;
  scheduleLookup: ScheduledLoadLookupRecord | null = null;
  scheduleChecking = false;
  scheduleLookupError = '';
  private scheduleLookupGeneration = 0;
  plantLocationName = 'Fort Wayne';
  referenceDrivers: DriverReferenceRecord[] = [];
  referenceCarriers: CarrierReferenceRecord[] = [];
  referenceLocations: LocationReferenceRecord[] = [];
  manualLoadEntry = false;
  phoneTouched = false;
  selectedFreightKey = '';
  selectedFreight: RxoFreightRecord | null = null;
  private pendingCheckInRequestId = '';
  private pendingCheckInFingerprint = '';

  form: CheckInForm = emptyCheckInForm();

  constructor(
    private readonly api: TruckLogApi,
    private readonly toast: ToastService,
    readonly loads: FreightLoadPicker,
    readonly print: DriverPrintTracker,
  ) {
    this.loads.onNoneAvailable = () => { this.manualLoadEntry = true; };
  }

  // The RXO/Expedite load picker (FreightLoadPicker) and the latest visit's print tracking (DriverPrintTracker).
  get freightLoads() { return this.loads.freightLoads; }
  get freightLoadsLoading() { return this.loads.freightLoadsLoading; }
  get freightLoadsError() { return this.loads.freightLoadsError; }
  get freightLoadsNoticeOnly() { return this.loads.freightLoadsNoticeOnly; }
  freightLoadKey(load: RxoFreightRecord) { return this.loads.freightLoadKey(load); }
  freightLoadLabel(load: RxoFreightRecord) { return this.loads.freightLoadLabel(load); }

  // Column-header dropdown lists (Dana UI combobox).
  readonly freightLoadKeyFn = (load: RxoFreightRecord) => this.loads.freightLoadKey(load);
  readonly loadNumberOf = (load: RxoFreightRecord) => load.shipment_id.trim().toUpperCase();
  readonly loadColumns: DanaComboboxColumn<RxoFreightRecord>[] = [
    { label: 'Load', value: (load) => load.shipment_id, width: 'minmax(110px, 1.1fr)' },
    { label: 'Source', value: (load) => load.site_key === 'fort-wayne-expedite' ? 'Expedite' : 'RXO', width: '74px' },
    { label: 'Direction', value: (load) => load.direction === 'INBOUND' ? 'Inbound' : 'Outbound', width: '78px' },
    { label: 'Carrier', value: (load) => load.carrier_name, width: 'minmax(110px, 1.3fr)' },
    { label: 'Trailer', value: (load) => load.trailer_number, width: '84px' },
    { label: 'Scheduled', value: (load) => shortDateTime(load.plant_scheduled_at), width: '118px', align: 'end' },
  ];
  readonly referenceKey = (row: { id: number; name: string }) => String(row.id);
  readonly referenceName = (row: { name: string }) => row.name;
  readonly driverColumns: DanaComboboxColumn<DriverReferenceRecord>[] = [
    { label: 'Driver', value: (driver) => driver.name, width: '1.4fr' },
    { label: 'Phone', value: (driver) => driver.phoneNumber || 'Not saved', width: '1fr' },
    { label: 'Last visit', value: (driver) => shortDate(driver.lastUsedAt), width: '90px', align: 'end' },
  ];
  readonly carrierColumns: DanaComboboxColumn<CarrierReferenceRecord>[] = [
    { label: 'Carrier', value: (carrier) => carrier.name, width: '1.6fr' },
    { label: 'Last visit', value: (carrier) => shortDate(carrier.lastUsedAt), width: '90px', align: 'end' },
  ];
  readonly locationColumns: DanaComboboxColumn<LocationReferenceRecord>[] = [
    { label: 'Location', value: (location) => location.name, width: '1.4fr' },
    { label: 'City', value: (location) => [location.city, location.state].filter(Boolean).join(', '), width: '1fr' },
    { label: 'Address', value: (location) => location.addressLine1, width: '1.2fr' },
  ];
  readonly dockKey = (dock: DockRecord) => dock.code;
  readonly dockText = (dock: DockRecord) => dock.description ? `${dock.code} — ${dock.description}` : dock.code;
  readonly dockColumns: DanaComboboxColumn<DockRecord>[] = [
    { label: 'Dock', value: (dock) => dock.code, width: '110px' },
    { label: 'Area', value: (dock) => dock.description, width: '1fr' },
  ];

  /** Picking a saved driver fills the phone saved with them. */
  driverPicked(driver: DriverReferenceRecord | null) {
    if (this.formDisabled) return;
    if (driver?.phoneNumber?.trim()) this.form.driverPhone = driver.phoneNumber.trim();
  }
  get lastVisitId() { return this.print.lastVisitId; }
  get lastVisit() { return this.print.lastVisit; }

  ngOnInit() {
    this.api.docks().subscribe({
      next: (docks) => { this.docks = docks; this.activeDocks = docks.filter((d) => d.active); this.docksLoaded = true; },
      error: () => { this.docksLoaded = true; this.toast.error('Could not load docks. Check System status.', 'Check-In setup failed'); },
    });

    this.api.checkInConfig().subscribe({
      next: (config: CheckInConfigRecord) => {
        this.automaticDriverPrinting = config.automaticDriverPrinting === true;
        this.printingConfigLoading = false;
        this.printingUnavailableReason = config.printingUnavailableReason?.trim() || '';
        if (!this.printModeEdited) this.printMode = this.automaticPrintingReady ? 'AUTOMATIC' : 'MANUAL';
        const configuredPlant = config.plantLocationName?.trim();
        if (configuredPlant) this.plantLocationName = configuredPlant;
        if (this.form.direction) this.applyDirectionEndpoints();
      },
      error: () => {
        this.printingConfigLoading = false;
        this.printingUnavailableReason = 'Printer setup could not be verified. Print the slip manually after saving.';
        // Fort Wayne and manual printing keep check-in usable during a setup read failure.
      },
    });

    this.loadReferenceData();
    this.loads.loadFreightLoads();
  }

  ngOnDestroy() {
    this.scheduleLookupGeneration += 1;
  }

  freightLoadSelected(selectionKey: string) {
    if (this.formDisabled) return;
    this.clearPendingCheckInRequest();
    this.resetSchedulePreview();
    this.selectedFreight = null;
    this.form.loadNumber = '';
    const normalizedKey = String(selectionKey || '').trim();
    if (!normalizedKey) return;

    const selected = this.freightLoads.find((row) => this.freightLoadKey(row) === normalizedKey);
    if (selected) {
      this.selectedFreight = selected;
      this.form.loadNumber = selected.shipment_id.trim().toUpperCase();
      // The selected RXO freight row is authoritative for load-owned fields.
      // Always replace prior RXO/manual values so changing the selected load cannot
      // leave a stale carrier, trailer, origin, or destination from the prior load.
      this.setDirection(selected.direction);
      this.form.carrierName = selected.carrier_name?.trim() || '';
      this.form.trailerId = selected.trailer_number?.trim().toUpperCase() || '';

      if (selected.direction === 'INBOUND') {
        this.form.originName = selected.first_stop_address?.trim() || '';
      }
      if (selected.direction === 'OUTBOUND') {
        this.form.destinationName = selected.last_stop_address?.trim() || '';
      }
    }
    this.lookupSchedule();
  }

  useManualLoadEntry() {
    if (this.formDisabled) return;
    this.manualLoadEntry = true;
    this.selectedFreightKey = '';
    this.selectedFreight = null;
    this.form.loadNumber = '';
    this.loadNumberChanged();
  }

  useFreightLoadPicker() {
    if (this.formDisabled) return;
    this.manualLoadEntry = false;
    this.selectedFreightKey = '';
    this.selectedFreight = null;
    this.form.loadNumber = '';
    this.loadNumberChanged();
  }

  private loadReferenceData() {
    this.api.checkInReferenceData().subscribe({
      next: (referenceData) => {
        this.referenceDrivers = referenceData.drivers;
        this.referenceCarriers = referenceData.carriers;
        this.referenceLocations = referenceData.locations;
      },
      error: () => {
        // Reference data is convenience/autocomplete only. Free-text check-in
        // remains available and the server will create/update reusable records.
      },
    });
  }

  driverNameChanged() {
    if (this.formDisabled) return;
    // Driver and carrier are independent. Clear any prior driver's phone as soon
    // as the operator changes the driver identity, then refill only on an exact
    // reusable Driver match.
    this.form.driverPhone = '';
  }

  driverSelectionChanged() {
    if (this.formDisabled) return;
    const needle = this.form.driverName.trim().toLocaleLowerCase();
    if (!needle) return;
    const match = this.referenceDrivers.find((driver) => driver.name.trim().toLocaleLowerCase() === needle);
    if (match) this.form.driverPhone = match.phoneNumber?.trim() || '';
  }

  private phoneDigits(value: string) {
    return String(value || '').replace(/\D/g, '');
  }

  get driverPhoneValid() {
    const value = this.form.driverPhone.trim();
    if (!value) return false;
    if (!/^\+?[0-9()\s.-]+$/.test(value)) return false;

    const digits = this.phoneDigits(value);
    return digits.length >= 7 && digits.length <= 15;
  }

  normalizeDriverPhone() {
    if (this.formDisabled) return;
    const value = this.form.driverPhone.trim();
    if (!value) {
      this.form.driverPhone = '';
      return;
    }

    const digits = this.phoneDigits(value);

    // Friendly North-American display format while still accepting
    // international numbers and preserving their entered formatting.
    if (digits.length === 10) {
      this.form.driverPhone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      return;
    }

    if (digits.length === 11 && digits.startsWith('1')) {
      this.form.driverPhone = `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
      return;
    }

    this.form.driverPhone = value;
  }

  paperworkFileSizeLabel(bytes: number) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;

    const megabytes = size / (1024 * 1024);
    return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
  }

  get loadRouteComplete() {
    return [this.form.loadNumber, this.form.direction, this.form.originName, this.form.destinationName]
      .filter((value) => Boolean(String(value || '').trim())).length;
  }
  get driverEquipmentComplete() {
    return [this.form.driverName, this.form.carrierName, this.form.tractorId, this.form.trailerId]
      .filter((value) => Boolean(String(value || '').trim())).length + (this.driverPhoneValid ? 1 : 0);
  }
  get dockAssignmentComplete() { return this.form.dockCode.trim() ? 1 : 0; }
  get selectedDriverDocument() {
    const document = this.selectedFreight?.driverDocument;
    return document && document.status !== 'NO_DOCUMENT' ? document : null;
  }
  get missingRequiredItems() {
    const required: Array<[string, boolean]> = [
      ['Load Number', Boolean(this.form.loadNumber.trim())],
      ['Direction', Boolean(this.form.direction)],
      ['Origin', Boolean(this.form.originName.trim())],
      ['Destination', Boolean(this.form.destinationName.trim())],
      ['Driver Name', Boolean(this.form.driverName.trim())],
      ['Driver Phone', this.driverPhoneValid],
      ['Carrier', Boolean(this.form.carrierName.trim())],
      ['Tractor ID', Boolean(this.form.tractorId.trim())],
      ['Trailer ID', Boolean(this.form.trailerId.trim())],
      ['Dock', Boolean(this.form.dockCode.trim())],
    ];
    return required.filter(([, complete]) => !complete).map(([label]) => label);
  }

  get visibleMissingRequiredItems() { return this.missingRequiredItems.slice(0, 3); }
  get hiddenMissingRequiredCount() { return Math.max(0, this.missingRequiredItems.length - this.visibleMissingRequiredItems.length); }
  get requiredComplete() { return 10 - this.missingRequiredItems.length; }
  get canSave() { return this.missingRequiredItems.length === 0 && this.activeDocks.length > 0; }

  setDirection(direction: 'INBOUND' | 'OUTBOUND') {
    if (this.formDisabled) return;
    if (this.form.direction !== direction) this.clearPendingCheckInRequest();
    if (this.selectedFreight && this.selectedFreight.direction !== direction) {
      this.selectedFreightKey = '';
      this.selectedFreight = null;
      this.form.loadNumber = '';
      this.resetSchedulePreview();
    }
    this.form.direction = direction;
    this.applyDirectionEndpoints();
  }

  private applyDirectionEndpoints() {
    const plant = this.plantLocationName.trim() || 'Fort Wayne';

    if (this.form.direction === 'OUTBOUND') {
      this.form.originName = plant;
      if (this.form.destinationName.trim().toLocaleLowerCase() === plant.toLocaleLowerCase()) {
        this.form.destinationName = '';
      }
      return;
    }

    if (this.form.direction === 'INBOUND') {
      this.form.destinationName = plant;
      if (this.form.originName.trim().toLocaleLowerCase() === plant.toLocaleLowerCase()) {
        this.form.originName = '';
      }
    }
  }

  loadNumberChanged() {
    if (this.formDisabled) return;
    this.clearPendingCheckInRequest();
    this.selectedFreightKey = '';
    this.selectedFreight = null;
    this.resetSchedulePreview();
  }

  private resetSchedulePreview() {
    this.scheduleLookupGeneration += 1;
    this.scheduleLookup = null;
    this.scheduleLookupError = '';
    this.scheduleChecking = false;
  }

  lookupSchedule() {
    const loadNumber = this.form.loadNumber.trim().toUpperCase();
    const generation = ++this.scheduleLookupGeneration;
    this.scheduleLookup = null;
    this.scheduleLookupError = '';
    if (!loadNumber) {
      this.scheduleChecking = false;
      return;
    }

    this.scheduleChecking = true;
    this.api.scheduledLoad(loadNumber).subscribe({
      next: (lookup) => {
        if (generation !== this.scheduleLookupGeneration || loadNumber !== this.form.loadNumber.trim().toUpperCase()) return;
        this.scheduleLookup = lookup;
        this.scheduleChecking = false;
      },
      error: () => {
        if (generation !== this.scheduleLookupGeneration || loadNumber !== this.form.loadNumber.trim().toUpperCase()) return;
        this.scheduleChecking = false;
        this.scheduleLookupError = 'Schedule preview unavailable; the server will verify the scheduled-load table again when you check in.';
      },
    });
  }

  filesSelected(event: Event) {
    if (this.formDisabled) return;
    const input = event.target as HTMLInputElement;
    const incoming = Array.from(input.files ?? []);
    const seen = new Set(this.files.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
    for (const file of incoming) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!seen.has(key)) { this.files.push(file); seen.add(key); }
    }
    input.value = '';
  }

  removeFile(index: number) { if (!this.formDisabled) this.files.splice(index, 1); }

  upper(key: UppercaseCheckInField) {
    if (this.formDisabled) return;
    this.form[key] = String(this.form[key] || '').trim().toUpperCase();
  }

  save() {
    if (!this.canSave || this.saving || this.visitLocked) return;

    if (this.printingConfigLoading) return;
    const automaticPrinting = this.printMode === 'AUTOMATIC';
    const gate = this.automaticGate;
    if (automaticPrinting && !this.automaticPrintingReady) {
      this.toast.warning('Choose Print manually in browser, or finish the gate printer setup.', 'Choose a printing option');
      return;
    }

    const rxoSelection: CheckInRxoSelection | null = this.selectedFreight
      ? {
          siteKey: this.selectedFreight.site_key,
          shipmentId: this.selectedFreight.shipment_id,
          direction: this.selectedFreight.direction,
        }
      : null;
    const rxoDocument = this.selectedDriverDocument;
    const requestWithoutId = {
      ...toCreateTruckVisitRequest(this.form, rxoSelection),
      ...(automaticPrinting && gate ? { guardGate: gate } : {}),
      autoPrintDockSlip: automaticPrinting,
    };
    const requestFingerprint = JSON.stringify(requestWithoutId);
    if (!this.pendingCheckInRequestId || this.pendingCheckInFingerprint !== requestFingerprint) {
      this.pendingCheckInRequestId = this.api.newIdempotencyKey();
      this.pendingCheckInFingerprint = requestFingerprint;
    }
    const request = { ...requestWithoutId, clientRequestId: this.pendingCheckInRequestId };
    this.printWindow = null;
    this.saving = true;
    this.api.createVisit(request).subscribe({
      next: (visit) => {
        // Use the key actually sent, even if a delayed form event changed local draft state.
        const guardActionKey = request.clientRequestId;
        this.clearPendingCheckInRequest();
        const checkedIn = (load: RxoFreightRecord) => rxoSelection
          ? load.site_key === rxoSelection.siteKey && load.shipment_id === rxoSelection.shipmentId && load.direction === rxoSelection.direction
          : load.shipment_id === visit.loadNumber && load.direction === visit.direction;
        this.loads.removeWhere(checkedIn);
        this.loads.loadFreightLoads();
        // Remembers the guard action key, then follows (or discovers) the print package.
        // Keep the previous successful print job visible until a replacement visit is accepted.
        this.print.beginDriverPrintContext();
        this.print.startTracking(visit, guardActionKey, rxoDocument, Boolean(rxoSelection) && automaticPrinting);
        this.lastCheckInManualPrinting = !automaticPrinting;
        this.visitLocked = true;
        this.toast.success(`${visit.driverName} checked in successfully — Dock ${visit.dockCode}.`, 'Truck checked in');
        if (automaticPrinting && !visit.driverPrintPackage?.automaticDockAssignment) {
          this.toast.error('The visit was saved without its automatic print package. Inspect the saved visit; do not check in again.', 'Print status needs review');
        }
        this.uploadQueue(visit, [...this.files]);
      },
      error: (e) => {
        this.saving = false;
        this.printWindow?.close();
        this.printWindow = null;
        if (e?.status === 409) this.loads.loadFreightLoads();
        this.toast.error(e?.error?.message || 'Check-in failed.', 'Check-In failed');
      },
    });
  }

  private uploadQueue(visit: TruckVisitRecord, queue: File[], notifyComplete = false) {
    const next = () => {
      const file = queue.shift();
      if (!file) {
        this.saving = false;
        this.retryFiles = [];
        this.files = [];
        this.visitLocked = false;
        this.form = emptyCheckInForm();
        this.selectedFreightKey = '';
        this.selectedFreight = null;
        this.phoneTouched = false;
        this.resetSchedulePreview();
        this.loadReferenceData();
        if (notifyComplete) this.toast.success('All remaining paperwork uploaded successfully.', 'Paperwork complete');
        return;
      }
      this.api.uploadDocument(visit.id, file).subscribe({
        next,
        error: (e) => {
          this.saving = false;
          this.retryFiles = [file, ...queue];
          this.files = [];
          this.toast.warning(`Check-in is saved, but paperwork upload stopped at ${file.name}: ${e?.error?.message || 'upload error'}. Use Retry Paperwork.`, 'Paperwork needs attention');
        },
      });
    };
    next();
  }

  retryPaperwork() {
    if (!this.lastVisit || !this.retryFiles.length || this.saving) return;
    this.saving = true;
    const retry = [...this.retryFiles];
    this.retryFiles = [];
    this.uploadQueue(this.lastVisit, retry, true);
  }

  printLastSlip() {
    if (this.lastVisitId) window.open(this.api.slipUrl(this.lastVisitId), '_blank');
  }

  private clearPendingCheckInRequest() {
    this.pendingCheckInRequestId = '';
    this.pendingCheckInFingerprint = '';
  }

  clearForm() {
    if (this.formDisabled) return;
    this.clearPendingCheckInRequest();
    this.form = emptyCheckInForm();
    this.selectedFreightKey = '';
    this.selectedFreight = null;
    this.phoneTouched = false;
    this.files = [];
    this.resetSchedulePreview();
  }


  get formDisabled() { return this.saving || this.visitLocked; }
  get automaticPrintingReady() { return this.automaticDriverPrinting && !!this.automaticGate; }
  get printingSetupMessage() {
    if (this.printingConfigLoading) return 'Checking gate printer setup…';
    if (!this.automaticDriverPrinting) return this.printingUnavailableReason || 'Automatic gate printing is not configured. Print the slip manually after saving.';
    if (!this.automaticGate) return 'Choose East or West under Administration → Printing to use automatic gate printing. Manual printing is available now.';
    return '';
  }
  choosePrintMode(mode: 'AUTOMATIC' | 'MANUAL') {
    if (this.formDisabled || !['AUTOMATIC', 'MANUAL'].includes(mode) || (mode === 'AUTOMATIC' && !this.automaticPrintingReady)) return;
    this.printModeEdited = true;
    this.printMode = mode;
    this.clearPendingCheckInRequest();
  }

  automaticDriverPrinting = false;

  get automaticGate(): 'EAST' | 'WEST' | null {
    try { const gate = window.localStorage.getItem('truckLogGuardGate'); return gate === 'EAST' || gate === 'WEST' ? gate : null; }
    catch { return null; }
  }
}

function shortDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function shortDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
