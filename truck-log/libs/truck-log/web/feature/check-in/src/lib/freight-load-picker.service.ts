import { Injectable, OnDestroy } from '@angular/core';
import type { RxoFreightRecord } from '@truck-log/shared/contracts';
import { TruckLogApi } from '@truck-log/web/data-access';

/**
 * Loads offered by the Check-In load picker: current standard RXO Freight On
 * The Move rows (all pages) merged with RXO Expedite check-in loads, keyed by
 * the full (site, direction, shipment) tuple and sorted by plant schedule.
 * Either source may fail independently; manual load entry always remains.
 */
@Injectable()
export class FreightLoadPicker implements OnDestroy {
  freightLoads: RxoFreightRecord[] = [];
  freightLoadsLoading = false;
  freightLoadsError = '';
  /** True when the only message is "nothing to pick" (not a failure). */
  freightLoadsNoticeOnly = false;
  /** Called when no RXO or Expedite load can be offered (the page switches to manual entry). */
  onNoneAvailable: () => void = () => undefined;
  private freightLoadGeneration = 0;
  private standardFreightLoads: RxoFreightRecord[] = [];
  private expediteFreightLoads: RxoFreightRecord[] = [];
  private standardLoadsPending = false;
  private expediteLoadsPending = false;
  private standardLoadsMessage = '';
  private expediteLoadsMessage = '';

  constructor(private readonly api: TruckLogApi) {}

  ngOnDestroy() {
    this.freightLoadGeneration += 1;
  }

  loadFreightLoads() {
    const generation = ++this.freightLoadGeneration;
    this.standardLoadsPending = true;
    this.expediteLoadsPending = true;
    this.freightLoadsLoading = true;
    this.standardLoadsMessage = '';
    this.expediteLoadsMessage = '';
    this.freightLoadsError = '';
    this.loadStandardFreightPage(generation);
    this.api.rxoExpediteCheckInLoads().subscribe({
      next: (result) => {
        if (generation !== this.freightLoadGeneration) return;
        this.expediteFreightLoads = result.rows;
        this.expediteLoadsPending = false;
        this.expediteLoadsMessage = result.unselectableCount
          ? `${result.unselectableCount} Expedite ${result.unselectableCount === 1 ? 'load needs' : 'loads need'} shipment identity or direction review before selection.` : '';
        this.publishFreightLoads();
      },
      error: () => {
        if (generation !== this.freightLoadGeneration) return;
        this.expediteFreightLoads = [];
        this.expediteLoadsPending = false;
        this.expediteLoadsMessage = 'Expedite loads are unavailable. Standard RXO and manual load entry remain available.';
        this.publishFreightLoads();
      },
    });
  }

  /** Drop loads that were just checked in so they cannot be picked twice before the reload arrives. */
  removeWhere(remove: (load: RxoFreightRecord) => boolean) {
    this.standardFreightLoads = this.standardFreightLoads.filter((load) => !remove(load));
    this.expediteFreightLoads = this.expediteFreightLoads.filter((load) => !remove(load));
    this.publishFreightLoads();
  }

  private loadStandardFreightPage(generation: number, page = 1, accumulated: RxoFreightRecord[] = []) {
    this.api.rxoData<RxoFreightRecord>('freight', { page, pageSize: 250 }).subscribe({
      next: (result) => {
        if (generation !== this.freightLoadGeneration) return;
        const merged = [...accumulated, ...result.rows].filter((row) => Boolean(row.shipment_id?.trim()));
        if (merged.length < result.total && result.rows.length) {
          this.loadStandardFreightPage(generation, page + 1, merged);
          return;
        }
        this.standardFreightLoads = merged;
        this.standardLoadsPending = false;
        this.publishFreightLoads();
      },
      error: () => {
        if (generation !== this.freightLoadGeneration) return;
        this.standardFreightLoads = [];
        this.standardLoadsPending = false;
        this.standardLoadsMessage = 'Freight On The Move is temporarily unavailable. Manual load entry is still available.';
        this.publishFreightLoads();
      },
    });
  }

  private publishFreightLoads() {
    const unique = new Map<string, RxoFreightRecord>();
    for (const row of [...this.standardFreightLoads, ...this.expediteFreightLoads]) {
      unique.set(this.freightLoadKey(row), row);
    }
    this.freightLoads = [...unique.values()].sort((left, right) => {
      const leftTime = Date.parse(left.plant_scheduled_at ?? '') || Number.MAX_SAFE_INTEGER;
      const rightTime = Date.parse(right.plant_scheduled_at ?? '') || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.shipment_id.localeCompare(right.shipment_id) || left.site_key.localeCompare(right.site_key);
    });
    this.freightLoadsLoading = this.standardLoadsPending || this.expediteLoadsPending;
    this.freightLoadsError = [this.standardLoadsMessage, this.expediteLoadsMessage].filter(Boolean).join(' ');
    this.freightLoadsNoticeOnly = false;
    if (!this.freightLoadsLoading && !this.freightLoads.length) {
      if (!this.freightLoadsError) {
        this.freightLoadsError = 'No RXO or Expedite loads are waiting. Enter the load number manually.';
        this.freightLoadsNoticeOnly = true;
      }
      this.onNoneAvailable();
    }
  }

  freightLoadKey(load: RxoFreightRecord) {
    // The business load assignment remains equivalent to [value]="load.shipment_id";
    // the option value now includes the full tuple so duplicate shipment IDs stay distinct.
    return [load.site_key, load.direction, load.shipment_id]
      .map((value) => encodeURIComponent(String(value || '').trim()))
      .join('|');
  }

  freightLoadLabel(load: RxoFreightRecord) {
    const details = [load.site_key === 'fort-wayne-expedite' ? 'RXO Expedite' : load.site_key, load.direction, load.carrier_name?.trim(), load.trailer_number?.trim()].filter(Boolean);
    return [load.shipment_id, ...details].join(' — ');
  }
}
