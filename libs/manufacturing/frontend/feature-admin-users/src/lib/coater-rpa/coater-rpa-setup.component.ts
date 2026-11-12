import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DanaConfirmDialogComponent, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective, DanaToneDirective } from '@dana/ui';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { Observable, concatMap, from, last } from 'rxjs';

import { adminApiErrorText } from '../admin-api.service';

type PartType = 'RING' | 'PINION';
interface PartMapping { summary: string; part_type: PartType; outer_part: string; inner_part: string }
interface RpaSettings {
  coater_display_name: string;
  next_number: number;
  unit_price: number;
  insurance_unit: number;
  recipients_to: string[];
  recipients_cc: string[];
  default_po: string | null;
  default_po_expires_on: string | null;
  default_po_enabled: boolean;
  updated_at: string;
}
interface RpaFormInfo {
  number: number | null;
  po: string | null;
  unit_price: number | null;
  insurance_unit: number | null;
  coater_name: string | null;
  parts: string[];
  lines: PartMapping[];
}
interface RpaSetup {
  settings: RpaSettings | null;
  form: {
    source: 'UPLOADED' | 'SAVED_REQUEST';
    file_name: string;
    uploaded_at: string | null;
    size: number;
    problem: string | null;
    found: RpaFormInfo | null;
  } | null;
  part_map: PartMapping[];
  last_number: number | null;
  email_enabled: boolean;
  ready: boolean;
}
interface SettingsForm {
  coater_display_name: string;
  next_number: number | null;
  unit_price: number | null;
  insurance_unit: number | null;
  recipients_to: string;
  recipients_cc: string;
  default_po: string;
  default_po_expires_on: string;
  default_po_enabled: boolean;
}

const API = '/api/v1/admin/coater-rpa';
const MAX_FORM_BYTES = 2 * 1024 * 1024;
const emptyMapping = (): PartMapping => ({ summary: '', part_type: 'RING', outer_part: '', inner_part: '' });
const keyOf = (mapping: Pick<PartMapping, 'summary' | 'part_type'>) => mapping.summary.trim().toUpperCase() + '|' + mapping.part_type;
const addresses = (text: string) => text.split(/[\s,;]+/).map(address => address.trim()).filter(Boolean);

/**
 * Admin setup for Coater RPA requests: the Excel form that is filled, who it is emailed to,
 * the PO and prices, and which form part numbers each Summary uses.
 */
@Component({
  selector: 'gear-admin-coater-rpa',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaConfirmDialogComponent, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective, DanaToneDirective],
  templateUrl: './coater-rpa-setup.component.html',
  styleUrls: ['./coater-rpa-setup.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoaterRpaSetupComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(GearToastService);

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  setup: RpaSetup | null = null;
  loading = false;
  busy = false;
  error = '';
  settings: SettingsForm = this.settingsFrom(null);
  /** True when the settings shown were read from the form, not yet saved. */
  settingsSuggested = false;
  mapping: PartMapping = emptyMapping();
  editingKey: string | null = null;

  ngOnInit(): void { this.refresh(); }

  get parts(): string[] { return this.setup?.form?.found?.parts ?? []; }

  /** Lines the form holds that have no saved mapping yet. */
  get suggestions(): PartMapping[] {
    const saved = new Set((this.setup?.part_map ?? []).map(keyOf));
    const seen = new Set<string>();
    return (this.setup?.form?.found?.lines ?? []).filter(line => {
      const key = keyOf(line);
      if (saved.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  refresh(): void {
    if (this.loading) return;
    this.loading = true; this.error = ''; this.cdr.markForCheck();
    this.http.get<RpaSetup>(API).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: setup => { this.loading = false; this.apply(setup, true); },
      error: (error: HttpErrorResponse) => { this.loading = false; this.error = adminApiErrorText(error) || 'Could not load the RPA setup.'; this.cdr.markForCheck(); },
    });
  }

  chooseFile(): void { this.fileInput?.nativeElement.click(); }

  upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy) return;
    if (!/\.xlsx$/i.test(file.name)) { this.error = 'Choose an Excel workbook saved as .xlsx.'; this.cdr.markForCheck(); return; }
    if (file.size > MAX_FORM_BYTES) { this.error = 'The form is larger than 2 MB.'; this.cdr.markForCheck(); return; }
    const body = new FormData();
    body.append('file', file, file.name);
    this.run(this.http.post<RpaSetup>(`${API}/form`, body), `${file.name} is now the RPA form.`, 'Form uploaded', true);
  }

  download(): void {
    const name = this.setup?.form?.file_name || 'rpa-form.xlsx';
    this.http.get(`${API}/form`, { responseType: 'blob' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => { this.error = 'The form could not be downloaded.'; this.cdr.markForCheck(); },
    });
  }

  saveSettings(): void {
    if (this.busy) return;
    const form = this.settings;
    const number = Number(form.next_number), price = Number(form.unit_price), insurance = Number(form.insurance_unit);
    const to = addresses(form.recipients_to), cc = addresses(form.recipients_cc);
    if (!form.coater_display_name.trim()) return this.fail('Enter the coater name shown on the request.');
    if (!Number.isInteger(number) || number < 1) return this.fail('The next RPA number must be a whole number.');
    const last = this.setup?.last_number;
    if (last !== null && last !== undefined && number <= last) return this.fail(`RPA ${last} has already been issued. The next number must be higher.`);
    if (form.unit_price === null || !(price >= 0)) return this.fail('Enter the unit price.');
    if (form.insurance_unit === null || !(insurance >= 0)) return this.fail('Enter the insurance value per piece.');
    const invalid = [...to, ...cc].find(address => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
    if (invalid) return this.fail(`${invalid} is not an email address.`);
    if (form.default_po_enabled && (!form.default_po.trim() || !form.default_po_expires_on)) {
      return this.fail('To use a default PO, enter the PO and the date it expires.');
    }
    this.run(this.http.put<RpaSetup>(`${API}/settings`, {
      coater_display_name: form.coater_display_name.trim(), next_number: number, unit_price: price, insurance_unit: insurance,
      recipients_to: to, recipients_cc: cc, default_po: form.default_po.trim() || null,
      default_po_expires_on: form.default_po_expires_on || null, default_po_enabled: form.default_po_enabled,
    }), 'RPA settings saved.', 'Settings saved', true);
  }

  editMapping(mapping: PartMapping): void {
    this.mapping = { ...mapping };
    this.editingKey = keyOf(mapping);
    this.error = '';
  }

  cancelMapping(): void { this.mapping = emptyMapping(); this.editingKey = null; }

  saveMapping(): void {
    if (this.busy) return;
    const mapping = { ...this.mapping, summary: this.mapping.summary.trim().toUpperCase(), outer_part: this.mapping.outer_part.trim(), inner_part: this.mapping.inner_part.trim() };
    if (!mapping.summary) return this.fail('Enter the Summary number.');
    if (!mapping.outer_part || !mapping.inner_part) return this.fail('Choose the outer and inner part for this Summary.');
    this.run(this.http.put<RpaSetup>(`${API}/part-map`, mapping), `${mapping.summary} ${mapping.part_type} saved.`, 'Mapping saved', false, () => this.cancelMapping());
  }

  /** The mapping waiting for the administrator to confirm its removal. */
  pendingRemoval: PartMapping | null = null;

  removeMapping(mapping: PartMapping): void {
    if (this.busy) return;
    this.pendingRemoval = mapping;
  }

  confirmRemoval(): void {
    const mapping = this.pendingRemoval;
    this.pendingRemoval = null;
    if (!mapping || this.busy) return;
    this.run(this.http.post<RpaSetup>(`${API}/part-map/remove`, { summary: mapping.summary, part_type: mapping.part_type }),
      `${mapping.summary} ${mapping.part_type} removed.`, 'Mapping removed', false, () => { if (this.editingKey === keyOf(mapping)) this.cancelMapping(); });
  }

  /** Save every line the form holds as a mapping, one after another. */
  addSuggestions(): void {
    const lines = this.suggestions;
    if (this.busy || !lines.length) return;
    this.run(from(lines).pipe(concatMap(line => this.http.put<RpaSetup>(`${API}/part-map`, line)), last()),
      `${lines.length} mapping${lines.length === 1 ? '' : 's'} added from the form.`, 'Mappings added', false);
  }

  sizeText(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
  trackMapping(_: number, mapping: PartMapping): string { return keyOf(mapping); }

  private fail(message: string): void { this.error = message; this.cdr.markForCheck(); }

  private run(request: Observable<RpaSetup>, message: string, title: string, resetSettings: boolean, done?: () => void): void {
    this.busy = true; this.error = ''; this.cdr.markForCheck();
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: setup => { this.busy = false; done?.(); this.apply(setup, resetSettings); this.toast.success(message, title); },
      error: (error: HttpErrorResponse) => {
        this.busy = false; this.error = adminApiErrorText(error) || 'The change could not be saved.'; this.cdr.markForCheck();
        // A batch may have saved some rows before it failed.
        this.http.get<RpaSetup>(API).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: setup => this.apply(setup, false), error: () => undefined });
      },
    });
  }

  private apply(setup: RpaSetup, resetSettings: boolean): void {
    this.setup = setup;
    // Unsaved settings typed by the administrator survive a form upload or a mapping change.
    if (resetSettings || (!setup.settings && this.settingsSuggested)) {
      this.settings = this.settingsFrom(setup);
      this.settingsSuggested = !setup.settings && !!setup.form?.found;
    }
    this.cdr.markForCheck();
  }

  private settingsFrom(setup: RpaSetup | null): SettingsForm {
    const saved = setup?.settings;
    if (saved) {
      return {
        coater_display_name: saved.coater_display_name, next_number: saved.next_number, unit_price: saved.unit_price,
        insurance_unit: saved.insurance_unit, recipients_to: saved.recipients_to.join(', '), recipients_cc: saved.recipients_cc.join(', '),
        default_po: saved.default_po ?? '', default_po_expires_on: saved.default_po_expires_on ?? '', default_po_enabled: saved.default_po_enabled,
      };
    }
    // Nothing saved yet: start from what the uploaded form holds.
    const found = setup?.form?.found;
    const next = Math.max(found?.number ?? 0, setup?.last_number ?? 0) + 1;
    return {
      coater_display_name: found?.coater_name ?? '', next_number: found?.number || setup?.last_number ? next : null,
      unit_price: found?.unit_price ?? null, insurance_unit: found?.insurance_unit ?? null,
      recipients_to: '', recipients_cc: '', default_po: found?.po ?? '', default_po_expires_on: '', default_po_enabled: false,
    };
  }
}
