import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaTableDirective, DanaTableShellDirective, DanaToneDirective } from '@dana/ui';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import {
  CUTTERGRIND_SHELF_LETTERS,
  CUTTERGRIND_SHELF_MAX_BINS,
  CUTTERGRIND_SHELF_MAX_LAYER,
  CuttergrindShelfPrefix,
  cuttergrindShelfBinSerials,
  describeCuttergrindShelfPrefix,
} from '@meshforge/manufacturing/shared/util-constants';
import { IBulkShelfLocationResult } from '@meshforge/manufacturing/shared/util-types';
import { firstValueFrom } from 'rxjs';

import { AdminApiService, AssetTagPrintResult, adminApiErrorText } from '../admin-api.service';

interface ResultRow extends IBulkShelfLocationResult { tag: string }

/** Dull and finished first: those are the shelves this screen is mostly for. */
const PREFIXES: CuttergrindShelfPrefix[] = ['CGDR', 'CGDP', 'CGFR', 'CGFP', 'CGRR', 'CGRP'];

/**
 * Admin > Locations: make every bin of one Cuttergrind shelf at once. Choose the shelf type
 * (CGDR, CGDP, CGFR, CGFP), the shelf letter, which layers and how many bins each layer has.
 */
@Component({
  selector: 'gear-admin-bulk-locations',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaTableDirective, DanaTableShellDirective, DanaToneDirective],
  templateUrl: './bulk-locations.component.html',
  styleUrls: ['./bulk-locations.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BulkLocationsComponent {
  private readonly api = inject(AdminApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly toast = inject(GearToastService);

  /** Tell the Locations tab to reload its list. */
  @Output() readonly created = new EventEmitter<void>();

  readonly prefixes = PREFIXES.map(prefix => ({ prefix, label: `${prefix} · ${describeCuttergrindShelfPrefix(prefix)}` }));
  readonly shelfLetters = [...CUTTERGRIND_SHELF_LETTERS];
  readonly layerNumbers = Array.from({ length: CUTTERGRIND_SHELF_MAX_LAYER }, (_, index) => index + 1);
  readonly maxBins = CUTTERGRIND_SHELF_MAX_BINS;

  prefix: CuttergrindShelfPrefix = 'CGDR';
  shelf = 'A';
  layers = new Set<number>([1]);
  bins = 6;
  printTags = false;

  busy = false;
  progress = '';
  error = '';
  results: ResultRow[] = [];

  get serials(): string[] {
    return cuttergrindShelfBinSerials(this.prefix, this.shelf, [...this.layers], Number(this.bins));
  }

  get problem(): string {
    const bins = Number(this.bins);
    if (!this.layers.size) return 'Choose at least one layer.';
    if (!Number.isInteger(bins) || bins < 1 || bins > this.maxBins) return `Bins per layer go from 1 to ${this.maxBins} (A to Z).`;
    return '';
  }

  /** "A to F" for 6 bins. */
  get binRange(): string {
    const bins = Number(this.bins);
    if (!Number.isInteger(bins) || bins < 1 || bins > this.maxBins) return '';
    return bins === 1 ? 'bin A' : `bins A to ${CUTTERGRIND_SHELF_LETTERS[bins - 1]}`;
  }

  /** The preview, one line per layer. */
  get preview(): Array<{ layer: number; first: string; last: string; count: number }> {
    const bins = Number(this.bins);
    if (this.problem) return [];
    return [...this.layers].sort((a, b) => a - b).map(layer => {
      const base = `${this.prefix}-${this.shelf}${layer}`;
      return { layer, first: `${base}A`, last: `${base}${CUTTERGRIND_SHELF_LETTERS[bins - 1]}`, count: bins };
    });
  }

  toggleLayer(layer: number): void {
    const next = new Set(this.layers);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    this.layers = next;
  }

  async create(): Promise<void> {
    if (this.busy || this.problem || !this.serials.length) return;
    this.busy = true; this.error = ''; this.results = []; this.progress = ''; this.cdr.markForCheck();
    try {
      const saved = await firstValueFrom(this.api.bulkCreateShelfLocations({
        prefix: this.prefix, shelf: this.shelf, layers: [...this.layers].sort((a, b) => a - b), bins: Number(this.bins),
      }));
      this.results = saved.locations.map(location => ({ ...location, tag: this.printTags ? 'Waiting' : '—' }));
      this.created.emit();
      if (this.printTags) await this.print();
      this.toast.success(
        `${saved.created} created${saved.existing ? `, ${saved.existing} already existed` : ''}.`,
        `${this.prefix}-${this.shelf} shelf`,
      );
    } catch (error) {
      this.error = error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'The shelf bins could not be created.';
    } finally {
      this.busy = false; this.progress = ''; this.cdr.markForCheck();
    }
  }

  trackSerial(_: number, row: ResultRow): string { return row.serial_number; }

  /** Print a tag for every bin; tags that cannot be sent to a printer come down as one file. */
  private async print(): Promise<void> {
    const files: AssetTagPrintResult[] = [];
    for (const [index, row] of this.results.entries()) {
      this.progress = `printing ${index + 1} of ${this.results.length}`; this.cdr.markForCheck();
      if (!row.enabled) { row.tag = 'Location is disabled'; continue; }
      try {
        const tag = await firstValueFrom(this.api.printAssetTag('LOCATION', row.id));
        if (tag.printed) row.tag = 'Printed';
        else { files.push(tag); row.tag = tag.printer_configured ? (tag.failure_reason || 'Printer did not answer: in the file') : 'In the downloaded file'; }
      } catch (error) {
        row.tag = error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'Not printed';
      }
      this.results = [...this.results];
    }
    if (files.length) this.download(files);
  }

  private download(files: AssetTagPrintResult[]): void {
    const parts = files.map(file => Uint8Array.from(window.atob(file.prn_base64), char => char.charCodeAt(0)));
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.prefix}-${this.shelf}-tags-${files.length}.prn`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
