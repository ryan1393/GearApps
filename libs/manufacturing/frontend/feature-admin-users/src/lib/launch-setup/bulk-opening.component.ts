import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaHelpComponent, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';
import { firstValueFrom } from 'rxjs';
import { adminApiErrorText } from '../admin-api.service';
import { OPENING_IMPORT_HEADER, OpeningImportRow, parseOpeningImport } from './opening-import';

interface Payload { tray_serial_number: string; summary_id: string; part_type_id: string; stage: string; shelf_serial_number: string; service_cycle: number }
interface ReviewRow extends OpeningImportRow { payload?: Payload; blades?: number; state: 'invalid' | 'ready' | 'saved' | 'failed' }
@Component({
  selector: 'gear-bulk-opening', standalone: true,
  imports: [CommonModule, FormsModule, DanaHelpComponent, DanaTableDirective, DanaTableShellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="gear-panel launch-panel" aria-labelledby="bulk-opening-title" [attr.aria-busy]="busy || readingFile">
      <h3 id="bulk-opening-title">Import opening inventory</h3>
      <p>Upload full trays already ground or coated. Review every row before recording inventory.
        <dana-help label="Opening inventory import format">CSV with six columns: tray, summary (include revision as shown in the list), part_type (RING or PINION), stage (READY_FOR_COATING or READY_FOR_CUTTER), shelf and service_cycle (0–99). Use up to 100 rows, without quotes or commas in values. Quantities come from the Summary. Existing stock is never replaced.</dana-help>
      </p>
      <button class="gear-btn gear-btn-secondary" type="button" (click)="template()">Download CSV template</button>
      <p *ngIf="!lookupsReady" role="status">Waiting for enabled Summaries and part types. If none are configured, add them in Admin before importing inventory.</p>
      <label class="gear-field">CSV file <input type="file" accept=".csv,text/csv" [disabled]="busy" (change)="file($event)" /></label>
      <label class="gear-field">Or paste CSV<textarea class="gear-input" rows="5" [(ngModel)]="text" [disabled]="busy" (ngModelChange)="invalidate()"></textarea></label>
      <div class="gear-admin-form-actions">
        <button class="gear-btn gear-btn-secondary" type="button" [disabled]="busy || readingFile || !text.trim() || !lookupsReady" (click)="preview()">{{ busy ? 'Working…' : 'Preview and validate' }}</button>
        <button class="gear-btn gear-btn-primary" type="button" [disabled]="busy || readingFile || !canCommit" (click)="commit()">Record {{ readyCount }} reviewed trays</button>
        <button class="gear-btn gear-btn-secondary" type="button" [disabled]="busy" (click)="clear()">Clear import</button>
      </div>
      <p *ngIf="readingFile" role="status">Reading CSV file…</p>
      <p *ngIf="progress" role="status">{{ progress }}</p>
      <p *ngIf="error" class="gear-alert gear-alert-danger" role="alert">{{ error }}</p>
      <p *ngIf="message" role="status">{{ message }}</p>
      <p *ngIf="rows.length">Each tray saves in its own transaction. Successful rows remain saved if another fails. Clearing this form does not remove recorded inventory. Retry failed rows by previewing a new file; saved trays will be rejected as already in use.</p>
      <div *ngIf="rows.length" danaTableShell><table danaTable class="gear-table" aria-label="Opening inventory review">
        <thead><tr><th data-dana-table-static>Line</th><th data-dana-table-static>Tray</th><th data-dana-table-static>Summary / type</th><th data-dana-table-static>Stage / shelf</th><th data-dana-table-static>Blades</th><th data-dana-table-static>Result</th></tr></thead>
        <tbody><tr *ngFor="let row of rows"><td>{{ row.line }}</td><td>{{ row.tray }}</td><td>{{ row.summary }} / {{ row.part_type }}</td><td>{{ row.stage }} / {{ row.shelf }}</td><td>{{ row.blades ?? '—' }}</td><td><strong>{{ row.state }}</strong> {{ row.error }}</td></tr></tbody>
      </table></div>
    </section>`,
  styles: [':host { display: block; min-width: 0; } .launch-panel { padding: 1.25rem; min-width: 0; } textarea, input[type="file"] { width: 100%; max-width: 100%; } .gear-admin-form-actions { display:flex; flex-wrap:wrap; gap:.5rem; margin:1rem 0; }'],
})
export class BulkOpeningComponent {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  @Input() summaries: Array<{ id: string; label: string }> = [];
  @Input() partTypes: Array<{ id: string; code: string }> = [];
  @Output() readonly recorded = new EventEmitter<void>();
  text = ''; rows: ReviewRow[] = []; busy = false; readingFile = false; error = ''; message = ''; progress = '';
  private fileVersion = 0;
  get lookupsReady(): boolean { return this.summaries.length > 0 && this.partTypes.length > 0; }
  get readyCount(): number { return this.rows.filter(row => row.state === 'ready').length; }
  get canCommit(): boolean { return this.rows.length > 0 && this.rows.every(row => row.state === 'ready'); }
  invalidate(): void { ++this.fileVersion; this.readingFile = false; this.rows = []; this.error = ''; this.message = ''; this.progress = ''; }
  clear(): void { this.text = ''; this.invalidate(); }
  async file(event: Event): Promise<void> {
    if (this.busy) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.invalidate();
    const version = this.fileVersion;
    this.text = '';
    input.value = '';
    if (file.size > 100_000) { this.error = 'Choose a CSV smaller than 100 KB.'; this.cdr.markForCheck(); return; }
    this.readingFile = true;
    this.cdr.markForCheck();
    try {
      const text = await file.text();
      if (version === this.fileVersion) this.text = text;
    } catch {
      if (version === this.fileVersion) this.error = 'Could not read the file. Choose it again or paste the CSV.';
    } finally {
      if (version === this.fileVersion) { this.readingFile = false; this.cdr.markForCheck(); }
    }
  }
  template(): void {
    const url = URL.createObjectURL(new Blob([OPENING_IMPORT_HEADER + '\nT0001,1010 rev A,RING,READY_FOR_COATING,CGRR-A1A,0\n'], { type: 'text/csv' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'opening-inventory-template.csv'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async preview(): Promise<void> {
    if (this.busy || this.readingFile || !this.lookupsReady) return;
    this.invalidate();
    try { this.rows = parseOpeningImport(this.text).map(row => ({ ...row, state: 'invalid' })); }
    catch (error) { this.error = (error as Error).message; return; }
    this.busy = true;
    try {
      for (const [index, row] of this.rows.entries()) {
        this.progress = `Validating tray ${index + 1} of ${this.rows.length}…`;
        this.cdr.markForCheck();
        if (row.error) continue;
        const matches = this.summaries.filter(summary => summary.label === row.summary);
        const partType = this.partTypes.find(type => type.code === row.part_type);
        if (matches.length !== 1 || !partType) { row.error = 'Unknown or ambiguous Summary / part type. Use the exact Summary label from Launch Setup.'; continue; }
        row.payload = { tray_serial_number: row.tray, summary_id: matches[0].id, part_type_id: partType.id, stage: row.stage, shelf_serial_number: row.shelf, service_cycle: row.service_cycle };
        try {
          const result = await firstValueFrom(this.http.post<{ blade_count: number }>('/api/v1/bladeTrays/opening-inventory/preview', row.payload));
          row.blades = result.blade_count; row.state = 'ready';
        } catch (error) { row.error = this.errorText(error); }
        this.cdr.markForCheck();
      }
      this.message = this.canCommit ? `${this.rows.length} trays validated. Review the table, then record them.` : 'Correct invalid rows and preview again. Nothing has been saved.';
    } finally { this.busy = false; this.progress = ''; this.cdr.markForCheck(); }
  }
  async commit(): Promise<void> {
    if (this.busy || this.readingFile || !this.canCommit) return;
    this.busy = true; this.message = '';
    try {
      for (const [index, row] of this.rows.entries()) {
        this.progress = `Recording tray ${index + 1} of ${this.rows.length}…`;
        this.cdr.markForCheck();
        try {
          await firstValueFrom(this.http.post('/api/v1/bladeTrays/opening-inventory', row.payload)); row.state = 'saved';
        } catch (error) { row.state = 'failed'; row.error = this.errorText(error); }
        this.cdr.markForCheck();
      }
      this.message = `${this.rows.filter(row => row.state === 'saved').length} saved; ${this.rows.filter(row => row.state === 'failed').length} failed.`;
      this.recorded.emit();
    } finally { this.busy = false; this.progress = ''; this.cdr.markForCheck(); }
  }
  private errorText(error: unknown): string { return error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'The request failed. Preview again to check the tray before retrying.'; }
}
