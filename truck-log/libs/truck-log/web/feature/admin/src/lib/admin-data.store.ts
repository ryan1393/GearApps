import { Injectable } from '@angular/core';
import type {
  CarrierReferenceRecord,
  DockRecord,
  DriverReferenceRecord,
  LocationReferenceRecord,
  ScheduledLoadRecord,
} from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';

/**
 * Administration reference data shared by the tab components (and the tab
 * counts). One `busy` flag serialises administrative changes as before.
 */
@Injectable()
export class AdminDataStore {
  docks: DockRecord[] = [];
  drivers: DriverReferenceRecord[] = [];
  carriers: CarrierReferenceRecord[] = [];
  locations: LocationReferenceRecord[] = [];
  scheduledLoads: ScheduledLoadRecord[] = [];
  busy = false;

  constructor(private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  get activeDockCount() { return this.docks.filter((d) => d.active).length; }

  load() {
    this.loadDrivers();
    this.loadCarriers();
    this.loadLocations();
    this.loadDocks();
    this.loadScheduledLoads();
  }

  loadDrivers() { this.api.drivers(true).subscribe({ next: (rows) => this.drivers = rows, error: () => this.toast.error('Could not load drivers.', 'Reference data failed') }); }
  loadCarriers() { this.api.carriers(true).subscribe({ next: (rows) => this.carriers = rows, error: () => this.toast.error('Could not load carriers.', 'Reference data failed') }); }
  loadLocations() { this.api.locations(true).subscribe({ next: (rows) => this.locations = rows, error: () => this.toast.error('Could not load locations.', 'Reference data failed') }); }
  loadDocks() { this.api.docks().subscribe({ next: (docks) => this.docks = docks, error: () => this.toast.error('Could not load docks.', 'Settings load failed') }); }
  loadScheduledLoads() {
    this.api.scheduledLoads().subscribe({
      next: (loads) => this.scheduledLoads = loads,
      error: () => this.toast.error('Could not load scheduled loads.', 'Settings load failed'),
    });
  }

  /** Replace one saved row with the server's copy; other rows (and their unsaved edits) are untouched. */
  replaceDriver(row: DriverReferenceRecord) { this.drivers = this.drivers.map((item) => item.id === row.id ? row : item); }
  replaceCarrier(row: CarrierReferenceRecord) { this.carriers = this.carriers.map((item) => item.id === row.id ? row : item); }
  replaceLocation(row: LocationReferenceRecord) { this.locations = this.locations.map((item) => item.id === row.id ? row : item); }
  replaceDock(row: DockRecord) { this.docks = this.docks.map((item) => item.id === row.id ? row : item); }
}

export function normalizedText(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase();
}
