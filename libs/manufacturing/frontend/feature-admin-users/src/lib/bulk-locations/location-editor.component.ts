import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DanaTableDirective, DanaTableShellDirective } from '@dana/ui';
import { firstValueFrom } from 'rxjs';
import { AdminApiService, AdminLocationRow, adminApiErrorText } from '../admin-api.service';
interface EditRow { id: string; serial: string; description: string; original: string; selected: boolean; result: string }
@Component({
  selector: 'gear-location-editor', standalone: true,
  imports: [CommonModule, FormsModule, DanaTableDirective, DanaTableShellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<details class="gear-panel" style="padding:1rem;margin-bottom:1rem">
    <summary>Mass edit location descriptions</summary>
    <p>Select records, edit their descriptions, then save. Inventory, barcodes and placements stay unchanged.</p>
    <label class="gear-field">Filter locations <input class="gear-input" [(ngModel)]="filter" [disabled]="busy" /></label>
    <div class="gear-admin-form-actions">
      <button type="button" class="gear-btn gear-btn-secondary" (click)="selectVisible()" [disabled]="busy || !visible.length">Select filtered</button>
      <button type="button" class="gear-btn gear-btn-primary" (click)="save()" [disabled]="busy || !dirtyCount || !!problem">Save {{ dirtyCount }} selected changes</button>
      <button type="button" class="gear-btn gear-btn-secondary" (click)="cancel()" [disabled]="busy">Cancel unsaved changes</button>
    </div>
    <p *ngIf="problem" role="alert" class="gear-alert gear-alert-danger">{{ problem }}</p>
    <p *ngIf="message" role="status">{{ message }}</p>
    <div danaTableShell><table danaTable class="gear-table"><thead><tr><th data-dana-table-static>Select</th><th data-dana-table-static>Barcode</th><th data-dana-table-static>Description</th><th data-dana-table-static>Result</th></tr></thead>
    <tbody><tr *ngFor="let row of visible"><td><input type="checkbox" [(ngModel)]="row.selected" [disabled]="busy" [attr.aria-label]="'Select ' + row.serial" /></td><td>{{ row.serial }}</td><td><input class="gear-input" [(ngModel)]="row.description" (ngModelChange)="row.result = ''" maxlength="255" [disabled]="busy" [attr.aria-label]="'Description for ' + row.serial" /></td><td>{{ row.result || (row.description !== row.original ? 'Unsaved' : 'Unchanged') }}</td></tr></tbody></table></div>
  </details>`,
})
export class LocationEditorComponent {
  private readonly api = inject(AdminApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  @Output() readonly saved = new EventEmitter<void>();
  @Input() set locations(values: AdminLocationRow[]) {
    const previous = new Map(this.rows.map(row => [row.id, row]));
    this.rows = values.map(row => previous.get(row.id) ?? ({ id: row.id, serial: row.serial_number, description: row.description ?? '', original: row.description ?? '', selected: false, result: '' }));
  }
  rows: EditRow[] = []; filter = ''; busy = false; message = '';
  get visible(): EditRow[] { const filter = this.filter.trim().toLowerCase(); return this.rows.filter(row => (row.serial + ' ' + row.original).toLowerCase().includes(filter)); }
  get changes(): EditRow[] { return this.rows.filter(row => row.selected && row.description !== row.original); }
  get dirtyCount(): number { return this.changes.length; }
  get problem(): string { return this.changes.some(row => row.description.length > 255) ? 'Descriptions must be 255 characters or fewer.' : ''; }
  selectVisible(): void { for (const row of this.visible) row.selected = true; }
  cancel(): void { for (const row of this.rows) { row.description = row.original; row.selected = false; row.result = ''; } this.message = ''; }
  async save(): Promise<void> {
    if (this.busy || !this.dirtyCount || this.problem) return;
    this.busy = true; let successes = 0, failures = 0;
    try {
      for (const row of this.changes) {
        try {
          const result = await firstValueFrom(this.api.updateLocation(row.id, { description: row.description.trim() || null }));
          row.description = result.description ?? ''; row.original = row.description; row.result = 'Saved'; row.selected = false; successes++;
        } catch (error) { row.result = error instanceof HttpErrorResponse ? adminApiErrorText(error) : 'Save failed. Reload to check before retrying.'; failures++; }
        this.cdr.markForCheck();
      }
      this.message = `${successes} saved; ${failures} failed. Failed changes remain selected for review.`;
      this.saved.emit();
    } finally { this.busy = false; this.cdr.markForCheck(); }
  }
}
