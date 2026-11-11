import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective, DanaToneDirective } from '@dana/ui';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { firstValueFrom } from 'rxjs';

import { AdminApiService, AssetTagKind, AssetTagPrintResult, adminApiErrorText } from '../admin-api.service';

interface LaunchStatus {
  setup: {
    users: number;
    grinders: number;
    cutter_builder_machines: number;
    production_machines: number;
    trays: number;
    containers: number;
    cutter_bodies: number;
    default_tag_printer: boolean;
    shelves: { dull: number; rough: number; finished: number; greenshed: number; other: number };
    coater_rpa_ready: boolean;
  };
  inventory: {
    stages: Array<{ code: string; name: string; trays: number; blades: number }>;
    cutters_built: number;
    cutters_running: number;
  };
}
interface ChecklistRow { label: string; value: string; done: boolean; hint: string; tab: string }
interface TagKind {
  id: string;
  label: string;
  kind: AssetTagKind;
  /** Barcodes follow fixed rules: a prefix, then digits (three exactly for numbered shelves). */
  prefix: string;
  digits?: number;
  description?: string;
}
interface TagResult { serial: string; state: 'created' | 'existing' | 'failed'; printed: boolean; note: string }
interface OpeningEntry { tray: string; summary: string; part_type: string; stage: string; shelf: string; blades: number }
interface Lookup { id: string; label: string }

const TAG_KINDS: TagKind[] = [
  // Tray and container barcodes are a letter and digits (T0301, C0101): the API refuses anything else.
  { id: 'tray', label: 'Trays (T####)', kind: 'TRAY', prefix: 'T' },
  { id: 'container', label: 'Coater containers (C####)', kind: 'CONTAINER', prefix: 'C' },
  { id: 'cgrr', label: 'Rough shelves, ring (CGRR-###)', kind: 'LOCATION', prefix: 'CGRR-', digits: 3, description: 'Cuttergrind rough RING shelf' },
  { id: 'cgrp', label: 'Rough shelves, pinion (CGRP-###)', kind: 'LOCATION', prefix: 'CGRP-', digits: 3, description: 'Cuttergrind rough PINION shelf' },
  { id: 'cgfr', label: 'Finished shelves, ring (CGFR-###)', kind: 'LOCATION', prefix: 'CGFR-', digits: 3, description: 'Cuttergrind finished RING shelf' },
  { id: 'cgfp', label: 'Finished shelves, pinion (CGFP-###)', kind: 'LOCATION', prefix: 'CGFP-', digits: 3, description: 'Cuttergrind finished PINION shelf' },
  { id: 'cgdr', label: 'Dull shelves, ring (CGDR-###)', kind: 'LOCATION', prefix: 'CGDR-', digits: 3, description: 'Cuttergrind dull RING shelf' },
  { id: 'cgdp', label: 'Dull shelves, pinion (CGDP-###)', kind: 'LOCATION', prefix: 'CGDP-', digits: 3, description: 'Cuttergrind dull PINION shelf' },
];
const MAX_TAGS = 100;

/**
 * Go-live in one place: what still has to be set up, barcode tags in bulk, and recording the
 * trays that are already ground or coated on the day the system starts.
 */
@Component({
  selector: 'gear-admin-launch-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective, DanaToneDirective],
  templateUrl: './launch-setup.component.html',
  styleUrls: ['./launch-setup.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaunchSetupComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(AdminApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(GearToastService);

  /** Ask the Admin screen to open another tab. */
  @Output() readonly openTab = new EventEmitter<string>();

  status: LaunchStatus | null = null;
  loading = false;
  error = '';

  // Tags
  readonly tagKinds = TAG_KINDS;
  tagKindId = 'tray';
  tagFirst = 1;
  tagCount = 10;
  tagDigits = 4;
  tagBusy = false;
  tagProgress = '';
  tagResults: TagResult[] = [];

  // Opening inventory
  summaries: Lookup[] = [];
  partTypes: Array<Lookup & { code: string }> = [];
  opening = { tray: '', summary_id: '', part_type_id: '', stage: 'READY_FOR_COATING', shelf: '', service_cycle: 0 };
  openingBusy = false;
  openingError = '';
  entries: OpeningEntry[] = [];

  ngOnInit(): void {
    this.refresh();
    this.loadLookups();
  }

  get tagKind(): TagKind { return this.tagKinds.find(kind => kind.id === this.tagKindId) ?? this.tagKinds[0]; }

  /** The serial numbers the current range makes. */
  get tagSerials(): string[] {
    const kind = this.tagKind;
    const prefix = kind.prefix ?? '';
    const digits = kind.digits ?? Math.min(Math.max(Number(this.tagDigits) || 1, 1), 8);
    const first = Math.max(Number(this.tagFirst) || 0, 0), count = Math.min(Math.max(Number(this.tagCount) || 0, 0), MAX_TAGS);
    return Array.from({ length: count }, (_, index) => prefix + String(first + index).padStart(digits, '0'));
  }

  get tagProblem(): string {
    const kind = this.tagKind;
    if (!Number.isInteger(Number(this.tagFirst)) || Number(this.tagFirst) < 0) return 'The first number must be a whole number.';
    if (!Number.isInteger(Number(this.tagCount)) || Number(this.tagCount) < 1 || Number(this.tagCount) > MAX_TAGS) return `Make 1 to ${MAX_TAGS} tags at a time.`;
    if (kind.digits && Number(this.tagFirst) + Number(this.tagCount) - 1 > 10 ** kind.digits - 1) return `Shelf numbers go up to ${10 ** kind.digits - 1}.`;
    return '';
  }

  get checklist(): ChecklistRow[] {
    const setup = this.status?.setup;
    if (!setup) return [];
    const row = (label: string, count: number, hint: string, tab: string): ChecklistRow =>
      ({ label, value: String(count), done: count > 0, hint, tab });
    return [
      row('User accounts', setup.users, 'Everyone who will scan needs an account in the right department.', 'users'),
      row('Grinders', setup.grinders, 'Add each grinder as a machine of type Grinder.', 'machines'),
      row('Cutter builder machines', setup.cutter_builder_machines, 'Add each build station as a machine of type Cutter Builder.', 'machines'),
      row('Production machines', setup.production_machines, 'The cutting machines Greenshed runs cutters on.', 'machines'),
      row('Rough shelves (CGRR / CGRP)', setup.shelves.rough, 'Numbered shelves for trays that are ground and waiting for the coater.', 'locations'),
      row('Finished shelves (CGFR / CGFP)', setup.shelves.finished, 'Numbered shelves for coated trays waiting for a cutter build.', 'locations'),
      row('Dull shelves (CGDR / CGDP)', setup.shelves.dull, 'Where torn-down trays wait for grinding.', 'locations'),
      row('Greenshed shelves (GSR / GSP)', setup.shelves.greenshed, 'Where built cutters wait for a machine.', 'locations'),
      row('Trays', setup.trays, 'Every physical tray needs a record and a barcode tag.', 'trays'),
      row('Coater containers', setup.containers, 'The containers trays ship to the coater in.', 'containers'),
      row('Cutter bodies', setup.cutter_bodies, 'The cutter bodies blades are built into.', 'cutter-bodies'),
      { label: 'Default tag printer', value: setup.default_tag_printer ? 'Set' : 'Not set', done: setup.default_tag_printer,
        hint: 'Without one, tags download as files to send to a printer by hand.', tab: 'label-printers' },
      { label: 'Coater RPA', value: setup.coater_rpa_ready ? 'Ready' : 'Not set up', done: setup.coater_rpa_ready,
        hint: 'The request form, recipients and part mappings.', tab: 'coater-rpa' },
    ];
  }

  get openingStageShelf(): string {
    const code = this.partTypes.find(type => type.id === this.opening.part_type_id)?.code;
    const ring = code !== 'PINION';
    return this.opening.stage === 'READY_FOR_COATING' ? (ring ? 'CGRR' : 'CGRP') : (ring ? 'CGFR' : 'CGFP');
  }

  refresh(): void {
    if (this.loading) return;
    this.loading = true; this.error = ''; this.cdr.markForCheck();
    this.http.get<LaunchStatus>('/api/v1/admin/master-data/launch-status').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: status => { this.status = status; this.loading = false; this.cdr.markForCheck(); },
      error: (error: HttpErrorResponse) => { this.loading = false; this.error = adminApiErrorText(error) || 'Could not load the launch status.'; this.cdr.markForCheck(); },
    });
  }

  onKindChange(): void {
    this.tagResults = [];
    this.tagDigits = 4;
  }

  /** Create the records that are missing, then print a tag for every serial in the range. */
  async makeTags(): Promise<void> {
    if (this.tagBusy || this.tagProblem) return;
    const kind = this.tagKind, serials = this.tagSerials;
    this.tagBusy = true; this.tagResults = []; this.error = '';
    const files: AssetTagPrintResult[] = [];
    try {
      for (const [index, serial] of serials.entries()) {
        this.tagProgress = `${index + 1} of ${serials.length}: ${serial}`; this.cdr.markForCheck();
        const result: TagResult = { serial, state: 'created', printed: false, note: '' };
        try {
          let id = await this.existingId(kind, serial);
          if (id) result.state = 'existing';
          else id = (await firstValueFrom(this.create(kind, serial))).id;
          const tag = await firstValueFrom(this.api.printAssetTag(kind.kind, id));
          result.printed = tag.printed;
          if (!tag.printed) { files.push(tag); result.note = tag.printer_configured ? (tag.failure_reason || 'The printer did not answer.') : 'No printer: tag file downloaded.'; }
        } catch (error) {
          result.state = 'failed';
          result.note = error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'Could not be created.';
        }
        this.tagResults = [...this.tagResults, result];
      }
      // Tags that could not be sent to a printer come down as one file to send by hand.
      if (files.length) this.downloadTags(files);
      const failed = this.tagResults.filter(result => result.state === 'failed').length;
      const made = this.tagResults.filter(result => result.state === 'created').length;
      this.toast.success(`${made} created, ${this.tagResults.length - made - failed} already existed${failed ? `, ${failed} failed` : ''}.`, 'Tags finished');
    } finally {
      this.tagBusy = false; this.tagProgress = ''; this.cdr.markForCheck();
      this.refresh();
    }
  }

  recordOpening(): void {
    if (this.openingBusy) return;
    const entry = this.opening;
    if (!entry.tray.trim()) { this.openingError = 'Scan or type the tray barcode.'; return; }
    if (!entry.summary_id || !entry.part_type_id) { this.openingError = 'Choose the Summary and part type of the blades in the tray.'; return; }
    if (!entry.shelf.trim()) { this.openingError = `Scan the ${this.openingStageShelf}-### shelf the tray is on.`; return; }
    this.openingBusy = true; this.openingError = ''; this.cdr.markForCheck();
    this.http.post<{ tray_serial_number: string; summary_number: string; part_type_code: string; stage_name: string; shelf_serial_number: string; blade_count: number }>(
      '/api/v1/bladeTrays/opening-inventory', {
        tray_serial_number: entry.tray.trim(), summary_id: entry.summary_id, part_type_id: entry.part_type_id,
        stage: entry.stage, shelf_serial_number: entry.shelf.trim(), service_cycle: Number(entry.service_cycle) || 0,
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: saved => {
        this.openingBusy = false;
        this.entries = [{ tray: saved.tray_serial_number, summary: saved.summary_number, part_type: saved.part_type_code,
          stage: saved.stage_name, shelf: saved.shelf_serial_number, blades: saved.blade_count }, ...this.entries];
        // Keep the Summary, type and stage: trays are usually entered a shelf at a time.
        this.opening = { ...entry, tray: '', shelf: '' };
        this.toast.success(`${saved.tray_serial_number}: ${saved.blade_count} blades, ${saved.stage_name}.`, 'Tray recorded');
        this.cdr.markForCheck();
        this.refresh();
      },
      error: (error: HttpErrorResponse) => { this.openingBusy = false; this.openingError = adminApiErrorText(error); this.cdr.markForCheck(); },
    });
  }

  trackSerial(_: number, result: TagResult): string { return result.serial; }

  private create(kind: TagKind, serial: string) {
    if (kind.kind === 'TRAY') return this.api.createTray({ serial_number: serial, enabled: true });
    if (kind.kind === 'CONTAINER') return this.api.createContainer({ serial_number: serial, enabled: true });
    return this.api.createLocation({
      serial_number: serial, number: serial.split('-').pop() ?? serial, description: kind.description ?? null,
      department: 'CUTTERGRIND', location_type: 'SHELF', enabled: true,
    });
  }

  private async existingId(kind: TagKind, serial: string): Promise<string | null> {
    const path = kind.kind === 'TRAY' ? 'trays' : kind.kind === 'CONTAINER' ? 'containers' : 'locations';
    try {
      const found = await firstValueFrom(this.http.get<{ id: string } | null>(`/api/v1/${path}/scan/${encodeURIComponent(serial)}`));
      return found?.id ?? null;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) return null;
      throw error;
    }
  }

  private downloadTags(files: AssetTagPrintResult[]): void {
    const parts = files.map(file => Uint8Array.from(window.atob(file.prn_base64), char => char.charCodeAt(0)));
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tags-${files.length}.prn`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private loadLookups(): void {
    this.http.get<Array<{ id: string; code: string; name?: string; enabled?: boolean }>>('/api/v1/part-types')
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: types => {
          this.partTypes = types.filter(type => type.enabled !== false && ['RING', 'PINION'].includes(type.code))
            .map(type => ({ id: type.id, code: type.code, label: type.code === 'RING' ? 'Ring' : 'Pinion' }));
          this.cdr.markForCheck();
        },
        error: () => { this.openingError = 'Could not load the part types. Reload this page.'; this.cdr.markForCheck(); },
      });
    void this.loadSummaries();
  }

  private async loadSummaries(): Promise<void> {
    const all: Lookup[] = [];
    try {
      for (let page = 1; page <= 50; page += 1) {
        const response = await firstValueFrom(this.api.listPartSummaries(page, 100));
        for (const row of response.data) {
          if (row.enabled !== false) all.push({ id: row.id, label: row.revision ? `${row.number} rev ${row.revision}` : row.number });
        }
        if (!response.meta?.hasNextPage) break;
      }
      this.summaries = all.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    } catch {
      this.openingError = 'Could not load the Part Summaries. Reload this page.';
    }
    this.cdr.markForCheck();
  }
}
