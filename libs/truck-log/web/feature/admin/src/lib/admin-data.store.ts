import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CarrierReferenceRecord,
  DockRecord,
  DriverReferenceRecord,
  LocationReferenceRecord,
  ScheduledLoadRecord,
} from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';
import { ToastService } from '@truck-log/web/ui';

export type AdminListKey = 'drivers' | 'carriers' | 'locations' | 'docks' | 'scheduledLoads';
export type AdminListState = 'loading' | 'ready' | 'error';

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
  /** Per list: 'loading' until the first answer, then 'ready' or 'error' (empty-state copy depends on it). */
  readonly state: Record<AdminListKey, AdminListState> = { drivers: 'loading', carriers: 'loading', locations: 'loading', docks: 'loading', scheduledLoads: 'loading' };

  constructor(private readonly api: TruckLogApi, private readonly toast: ToastService) {}

  get activeDockCount() { return this.docks.filter((d) => d.active).length; }

  load() {
    this.loadDrivers();
    this.loadCarriers();
    this.loadLocations();
    this.loadDocks();
    this.loadScheduledLoads();
  }

  loadDrivers() { this.fetch('drivers', this.api.drivers(true), (rows) => this.drivers = rows, 'Could not load drivers.', 'Reference data failed'); }
  loadCarriers() { this.fetch('carriers', this.api.carriers(true), (rows) => this.carriers = rows, 'Could not load carriers.', 'Reference data failed'); }
  loadLocations() { this.fetch('locations', this.api.locations(true), (rows) => this.locations = rows, 'Could not load locations.', 'Reference data failed'); }
  loadDocks() { this.fetch('docks', this.api.docks(), (docks) => this.docks = docks, 'Could not load docks.', 'Settings load failed'); }
  loadScheduledLoads() { this.fetch('scheduledLoads', this.api.scheduledLoads(), (loads) => this.scheduledLoads = loads, 'Could not load scheduled loads.', 'Settings load failed'); }

  private fetch<T>(key: AdminListKey, request: Observable<T>, apply: (rows: T) => void, message: string, title: string) {
    // Keep 'ready' during a reload so the current rows stay on screen instead of flashing "loading".
    if (this.state[key] !== 'ready') this.state[key] = 'loading';
    request.subscribe({
      next: (rows) => { apply(rows); this.state[key] = 'ready'; },
      error: () => { if (this.state[key] !== 'ready') this.state[key] = 'error'; this.toast.error(message, title); },
    });
  }

  /** Empty-list copy that tells "still loading", "failed", "none saved yet" and "filter hides all" apart. */
  emptyText(key: AdminListKey, noun: string, filter: string): string {
    if (this.state[key] === 'loading') return `Loading ${noun}…`;
    if (this.state[key] === 'error') return `${noun[0].toUpperCase()}${noun.slice(1)} could not be loaded. Reload the page to try again.`;
    return filter.trim() ? `No ${noun} match this filter.` : `No saved ${noun} yet.`;
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
