import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective } from '@dana/ui';
import { GearToastService, LabelLanguage, LabelType } from '@gearapps/manufacturing/frontend/util-common';

import { adminApiErrorText } from '../admin-api.service';

interface LabelPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
  label_type: LabelType;
  language: LabelLanguage;
  is_default: boolean;
  enabled: boolean;
  offset_right: number;
  offset_down: number;
}
interface LabelPrinterBoard {
  available: boolean;
  printers: LabelPrinter[];
  environment_printer: { host: string; port: number; language: LabelLanguage } | null;
}
interface PrinterForm {
  name: string;
  host: string;
  port: number;
  label_type: LabelType;
  language: LabelLanguage;
  is_default: boolean;
  enabled: boolean;
  offset_right: number;
  offset_down: number;
}
interface TestOutcome { ok: boolean; text: string }

const emptyForm = (): PrinterForm => ({ name: '', host: '', port: 9100, label_type: 'ASSET_TAG', language: 'IPL', is_default: false, enabled: true, offset_right: 0, offset_down: 0 });
/** The API accepts adjustments of up to this many dots either way. */
const ADJUSTMENT_LIMIT = 100;
const API = '/api/v1/label-printers';

/**
 * Admin list of label printers: where each one is, which language it speaks (Intermec IPL or
 * Zebra ZPL), what it is loaded with, and which is the default for tags and for cutter cards.
 */
@Component({
  selector: 'gear-admin-label-printers',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],
  templateUrl: './label-printers.component.html',
  styleUrls: ['./label-printers.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelPrintersComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(GearToastService);

  @ViewChild('nameInput') private nameInput?: ElementRef<HTMLInputElement>;

  board: LabelPrinterBoard | null = null;
  loading = false;
  saving = false;
  error = '';
  form: PrinterForm = emptyForm();
  editingId: string | null = null;
  /** The printer a test or action is running on, so only its buttons wait. */
  busyId: string | null = null;
  tests: Record<string, TestOutcome> = {};
  confirmRemoveId: string | null = null;

  ngOnInit(): void { this.refresh(); }

  get printers(): LabelPrinter[] { return this.board?.printers ?? []; }

  /** What a kind of label prints to right now, in words. */
  defaultSummary(labelType: LabelType): string {
    const preferred = this.printers.find((printer) => printer.label_type === labelType && printer.is_default && printer.enabled);
    if (preferred) return `${preferred.name} (${preferred.language})`;
    const fallback = this.board?.environment_printer;
    if (labelType === 'ASSET_TAG' && fallback) return `Server setting ${fallback.host}:${fallback.port} (${fallback.language})`;
    return labelType === 'ASSET_TAG' ? 'None: tags download as files' : 'None: cards download as files';
  }

  /** "moved 5 right, 3 up" for a printer whose labels have been nudged; empty when untouched. */
  adjustmentText(printer: LabelPrinter): string {
    const parts = [
      printer.offset_right ? `${Math.abs(printer.offset_right)} ${printer.offset_right > 0 ? 'right' : 'left'}` : '',
      printer.offset_down ? `${Math.abs(printer.offset_down)} ${printer.offset_down > 0 ? 'down' : 'up'}` : '',
    ].filter(Boolean);
    return parts.length ? `Moved ${parts.join(', ')} (dots)` : '';
  }

  typeName(labelType: LabelType): string { return labelType === 'CUTTER_CARD' ? 'Cutter cards' : 'Tray / container / location tags'; }
  languageName(language: LabelLanguage): string { return language === 'ZPL' ? 'ZPL (Zebra)' : 'IPL (Intermec)'; }

  refresh(): void {
    if (this.loading) return;
    this.loading = true; this.error = ''; this.cdr.markForCheck();
    this.http.get<LabelPrinterBoard>(`${API}/admin`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (board) => { this.board = board; this.loading = false; this.cdr.markForCheck(); },
      error: (error: HttpErrorResponse) => { this.loading = false; this.error = adminApiErrorText(error) || 'Could not load the label printers.'; this.cdr.markForCheck(); },
    });
  }

  edit(printer: LabelPrinter): void {
    this.editingId = printer.id;
    this.form = { name: printer.name, host: printer.host, port: printer.port, label_type: printer.label_type, language: printer.language, is_default: printer.is_default, enabled: printer.enabled, offset_right: printer.offset_right, offset_down: printer.offset_down };
    this.error = ''; this.confirmRemoveId = null;
    setTimeout(() => this.nameInput?.nativeElement.focus());
  }

  cancelEdit(): void { this.editingId = null; this.form = emptyForm(); this.error = ''; }

  save(): void {
    if (this.saving) return;
    const name = this.form.name.trim();
    const host = this.form.host.trim();
    const port = Number(this.form.port);
    if (!name) { this.error = 'Give the printer a name operators will recognise, for example Cutter Grind Zebra.'; return; }
    if (!host) { this.error = 'Enter the printer IP address, for example 10.16.40.25.'; return; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { this.error = 'Port must be a whole number from 1 to 65535. Raw label printing is normally 9100.'; return; }
    const offsetRight = Number(this.form.offset_right ?? 0);
    const offsetDown = Number(this.form.offset_down ?? 0);
    if (![offsetRight, offsetDown].every((value) => Number.isInteger(value) && Math.abs(value) <= ADJUSTMENT_LIMIT)) {
      this.error = `Position adjustments are whole dots from -${ADJUSTMENT_LIMIT} to ${ADJUSTMENT_LIMIT}. 8 dots are about 1 mm.`;
      return;
    }
    const body = { ...this.form, name, host, port, offset_right: offsetRight, offset_down: offsetDown, is_default: this.form.enabled && this.form.is_default };
    this.saving = true; this.error = '';
    const request = this.editingId ? this.http.put<LabelPrinter>(`${API}/${this.editingId}`, body) : this.http.post<LabelPrinter>(API, body);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.saving = false;
        this.toast.success(`${saved.name} saved${saved.is_default ? ` as the default for ${this.typeName(saved.label_type).toLowerCase()}` : ''}.`, 'Printer saved');
        this.cancelEdit(); this.refresh();
      },
      error: (error: HttpErrorResponse) => { this.saving = false; this.error = adminApiErrorText(error) || 'Could not save the printer.'; this.cdr.markForCheck(); },
    });
  }

  makeDefault(printer: LabelPrinter): void {
    this.change(printer, { is_default: true, enabled: true }, `${printer.name} is now the default for ${this.typeName(printer.label_type).toLowerCase()}.`);
  }

  setEnabled(printer: LabelPrinter, enabled: boolean): void {
    this.change(printer, { enabled, is_default: enabled && printer.is_default }, enabled ? `${printer.name} is available again.` : `${printer.name} is turned off and no longer offered.`);
  }

  private change(printer: LabelPrinter, patch: Partial<PrinterForm>, done: string): void {
    if (this.busyId) return;
    this.busyId = printer.id; this.error = '';
    const { name, host, port, label_type, language, is_default, enabled, offset_right, offset_down } = printer;
    this.http.put<LabelPrinter>(`${API}/${printer.id}`, { name, host, port, label_type, language, is_default, enabled, offset_right, offset_down, ...patch })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.busyId = null; this.toast.success(done, 'Printer updated'); this.refresh(); },
        error: (error: HttpErrorResponse) => { this.busyId = null; this.error = adminApiErrorText(error) || 'Could not update the printer.'; this.cdr.markForCheck(); },
      });
  }

  remove(printer: LabelPrinter): void {
    if (this.busyId) return;
    this.busyId = printer.id; this.error = '';
    this.http.delete(`${API}/${printer.id}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId = null; this.confirmRemoveId = null;
        if (this.editingId === printer.id) this.cancelEdit();
        this.toast.success(`${printer.name} removed.`, 'Printer removed'); this.refresh();
      },
      error: (error: HttpErrorResponse) => { this.busyId = null; this.error = adminApiErrorText(error) || 'Could not remove the printer.'; this.cdr.markForCheck(); },
    });
  }

  /** Checks that the server can reach the printer. Nothing is printed. */
  testConnection(printer: LabelPrinter): void {
    if (this.busyId) return;
    this.busyId = printer.id; delete this.tests[printer.id];
    this.http.post<{ ok: boolean; message: string }>(`${API}/${printer.id}/test`, {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => { this.busyId = null; this.tests[printer.id] = { ok: result.ok, text: result.message }; this.cdr.markForCheck(); },
      error: (error: HttpErrorResponse) => { this.busyId = null; this.tests[printer.id] = { ok: false, text: adminApiErrorText(error) || 'The test could not be run.' }; this.cdr.markForCheck(); },
    });
  }

  /** Prints a tag reading TEST, to check the language and how it sits on the label. */
  printTestTag(printer: LabelPrinter): void {
    if (this.busyId) return;
    this.busyId = printer.id; delete this.tests[printer.id];
    this.http.post<{ printed: boolean; failure_reason: string | null }>(`/api/v1/asset-tags/test-print/${printer.id}`, {})
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => {
          this.busyId = null;
          this.tests[printer.id] = result.printed
            ? { ok: true, text: `Test tag sent in ${printer.language}. If nothing printed, switch the printer between IPL and ZPL. If it sits off-centre, Edit the printer and move it right or down.` }
            : { ok: false, text: result.failure_reason || 'The printer did not accept the test tag.' };
          this.cdr.markForCheck();
        },
        error: (error: HttpErrorResponse) => { this.busyId = null; this.tests[printer.id] = { ok: false, text: adminApiErrorText(error) || 'The test tag could not be sent.' }; this.cdr.markForCheck(); },
      });
  }
}
