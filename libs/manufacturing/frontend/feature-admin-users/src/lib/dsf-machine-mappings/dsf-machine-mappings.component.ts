import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  DanaSummaryCardDirective,
  DanaSummaryGridDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaToneDirective,
} from '@dana/ui';

interface DsfSourceOption {
  mapping_id: string; whiteboard_id: string; op_id: string; line_id: string; department_id: string;
  department: string; line_name: string; whiteboard_name: string; mapping_active: boolean;
  whiteboard_active: boolean; operation_line_matches: boolean; active_mappings: number; running_reasons: number;
  assigned_machine_id: string | null;
}
interface DsfMappingInfo {
  mapping_id: string; whiteboard_id: string; op_id: string; line_id: string; department_id: string;
  line_name: string; whiteboard_name: string; manual: boolean; blocked: string | null;
}
interface AdminMappingRow {
  machine_id: string; machine_number: string; department: string; active: boolean; status: string;
  count: number | null; note: string; shift_number: number | null; as_of: string | null;
  mapping_origin: 'ADMIN' | 'UNMAPPED' | 'REFERENCE' | 'NONE'; mapping: DsfMappingInfo | null;
  writer_status: string; writer_reason: string;
}
interface DsfMappingBoard {
  format: string; status: string; enabled: boolean; configured: boolean; interval_seconds: number;
  last_success_at: string | null; served_at: string; cutter_write_enabled: boolean;
  last_failure: { reason: string; code: string | null; at: string } | null;
  /** Why DSF is switched on but the reader is not running. Names the setting, never its value. Absent on older APIs. */
  config_problem?: string | null;
  /** Why the DSF source list is empty after a read. Absent on older APIs. */
  source_options_problem?: { reason: string; code: string | null } | null;
  source_options_status: string; source_options_refreshed_at: string | null;
  source_options: DsfSourceOption[]; rows: AdminMappingRow[];
}

/**
 * Admin view of the DSF source for each physical machine across departments.
 * Saving changes MeshForge only; nothing is ever written to DSF.
 */
@Component({
  selector: 'gear-admin-dsf-machine-mappings',
  standalone: true,
  imports: [DanaToneDirective, CommonModule, FormsModule, DanaSummaryGridDirective, DanaSummaryCardDirective, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],
  templateUrl: './dsf-machine-mappings.component.html',
  styleUrls: ['./dsf-machine-mappings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DsfMachineMappingsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  loading = false; saving = false; error = ''; success = '';
  board: DsfMappingBoard | null = null;
  department = 'all'; statusFilter = 'active'; search = '';
  @ViewChild('editor') private editor?: ElementRef<HTMLElement>;
  selectedMachineId: string | null = null; sourceSearch = ''; selectedMappingId = '';

  ngOnInit(): void { this.refresh(); }

  refresh(clearSuccess = true): void {
    if (this.loading) return;
    this.loading = true; this.error = ''; if (clearSuccess) this.success = ''; this.cdr.markForCheck();
    this.http.get<DsfMappingBoard>('/api/v1/greenshed/dsf-counts/admin-mappings').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: board => {
        if (board?.format !== 'DSFMAPADMIN1' || !Array.isArray(board.rows) || !Array.isArray(board.source_options)) {
          this.error = 'Unexpected DSF mapping response.';
        } else { this.board = board; this.syncSelected(); }
        this.loading = false; this.cdr.markForCheck();
      },
      error: () => { this.error = 'Unable to load DSF mappings. Check your Admin session and the API.'; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  get departments(): string[] { return [...new Set(this.rows.map(row => row.department))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true})); }
  get rows(): AdminMappingRow[] { return this.board?.rows || []; }
  get visibleRows(): AdminMappingRow[] {
    const text = this.search.trim().toUpperCase();
    return this.rows.filter(row => (this.department === 'all' || row.department === this.department) &&
      (this.statusFilter === 'all' || (this.statusFilter === 'active' ? row.active : this.statusFilter === 'mapped' ? this.counting(row) : this.classification(row) === this.statusFilter)) &&
      (!text || [row.machine_number, row.department, row.status, row.note, row.mapping?.whiteboard_name, row.mapping?.line_name,
        row.writer_reason].some(value => String(value || '').toUpperCase().includes(text))));
  }
  get selected(): AdminMappingRow | null { return this.rows.find(row => row.machine_id === this.selectedMachineId) || null; }
  get activeCount(): number { return this.rows.filter(row => row.active).length; }
  /** Mapped, verified against DSF, and publishing a count (possibly a slightly old one). */
  counting(row: AdminMappingRow): boolean { return row.active && !!row.mapping && ['OK', 'STALE'].includes(row.status); }
  get mappedCount(): number { return this.rows.filter(row => this.counting(row)).length; }
  get reviewCount(): number { return this.rows.filter(row => this.classification(row) === 'review').length; }
  get writerReviewCount(): number { return this.rows.filter(row => row.writer_status === 'REVIEW').length; }
  get filteredSources(): DsfSourceOption[] {
    const row = this.selected; if (!row || !this.board) return [];
    const text = this.sourceSearch.trim().toUpperCase();
    return this.board.source_options.filter(option => option.department === row.department && option.mapping_active && option.whiteboard_active &&
      option.operation_line_matches && option.running_reasons > 0 && (!option.assigned_machine_id || option.assigned_machine_id === row.machine_id) &&
      (!text || [option.whiteboard_name, option.line_name, option.mapping_id].some(value => String(value || '').toUpperCase().includes(text))))
      .sort((a, b) => a.whiteboard_name.localeCompare(b.whiteboard_name));
  }
  get selectedSource(): DsfSourceOption | null { return this.board?.source_options.find(x => x.mapping_id === this.selectedMappingId) || null; }

  /** What an administrator should read first: is the DSF reader off, failing, or working? */
  get readerSummary(): { tone: 'off' | 'problem' | 'ok' | 'waiting'; text: string } {
    const board = this.board;
    if (!board) return { tone: 'waiting', text: '' };
    if (!board.enabled) return { tone: 'off', text: 'DSF counts are switched off for this API (DSF_COUNT_ENABLED). Nothing is read from DSF and existing counters are unchanged.' };
    if (board.config_problem) return { tone: 'problem', text: 'DSF counts are switched on but the reader is not running: ' + board.config_problem + ' Fix it in Admin > Server Settings or the server .env, then restart the API.' };
    if (!board.configured) return { tone: 'problem', text: 'DSF counts are switched on but the DSF_* connection settings are incomplete or invalid, so the reader is not running. See the API start-up log.' };
    if (board.last_failure) {
      const code = board.last_failure.code ? ' (' + board.last_failure.code + ')' : '';
      const hint = this.codeHint(board.last_failure.code);
      return { tone: 'problem', text: 'The last DSF read failed: ' + this.failureText(board.last_failure.reason) + code + '. ' + (hint ? hint + ' ' : '') + 'Last good read: ' + this.safeTime(board.last_success_at) + '.' };
    }
    if (!board.last_success_at) return { tone: 'waiting', text: 'Waiting for the first DSF read.' };
    return { tone: 'ok', text: 'Reading DSF every ' + board.interval_seconds + ' seconds. Last good read: ' + this.safeTime(board.last_success_at) + '.' };
  }
  private failureText(reason: string): string {
    const text: Record<string, string> = {
      SOURCE_CONNECTION_OR_QUERY_FAILED: 'could not connect to or query the DSF database',
      READ_ONLY_ROLE_REQUIRED: 'the DSF login is not a restricted read-only account',
      SOURCE_ACCOUNT_MISMATCH: 'the DSF login or database is not the configured one',
      WRONG_SOURCE_OR_NOT_READ_ONLY: 'the database reached is not the DSF source, or the session is not read-only',
      CLOCK_DIFFERENCE: 'the DSF and MeshForge clocks differ by more than 10 seconds',
      READER_BUSY: 'another API process is already reading DSF',
      READ_DEADLINE: 'the read took too long',
    };
    return text[reason] || reason.replace(/_/g, ' ').toLowerCase();
  }
  /** What to check for the common driver, network and TLS codes of a failed DSF connection. */
  codeHint(code: string | null | undefined): string {
    if (!code) return '';
    const hints: Record<string, string> = {
      ECONNREFUSED: 'Nothing accepted the connection: check DSF_DB_HOST and DSF_DB_PORT.',
      ETIMEDOUT: 'No reply from the DSF server: check DSF_DB_HOST and that the API server can reach it through the firewall.',
      CONNECT_TIMEOUT: 'No reply from the DSF server within 5 seconds: check DSF_DB_HOST, DSF_DB_PORT and the firewall.',
      EHOSTUNREACH: 'The DSF server cannot be reached from the API server: check DSF_DB_HOST and the network route.',
      ENETUNREACH: 'The DSF network cannot be reached from the API server (inside Docker, check the container can reach the plant network).',
      ENOTFOUND: 'DSF_DB_HOST is not a known host name: use the server IP address or a resolvable name.',
      EAI_AGAIN: 'DSF_DB_HOST could not be looked up: use the server IP address or check DNS.',
      ECONNRESET: 'The DSF server closed the connection: often an SSL mismatch, so try the other DSF_DB_SSL_MODE.',
      CONNECTION_TERMINATED: 'The DSF server closed the connection: often an SSL mismatch, so try the other DSF_DB_SSL_MODE.',
      SSL_NOT_SUPPORTED: 'The DSF server does not offer SSL: set DSF_DB_SSL_MODE=disable.',
      DEPTH_ZERO_SELF_SIGNED_CERT: 'The DSF server certificate is self-signed: supply it in DSF_DB_SSL_CA_PEM, or set DSF_DB_SSL_MODE=disable on a trusted plant network.',
      SELF_SIGNED_CERT_IN_CHAIN: 'The DSF certificate authority is not trusted: supply it in DSF_DB_SSL_CA_PEM.',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The DSF certificate authority is not trusted: supply it in DSF_DB_SSL_CA_PEM.',
      UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The DSF certificate authority is not trusted: supply it in DSF_DB_SSL_CA_PEM.',
      ERR_TLS_CERT_ALTNAME_INVALID: 'The DSF certificate does not name DSF_DB_HOST: connect by the name on the certificate.',
      CERT_HAS_EXPIRED: 'The DSF server certificate has expired.',
      '28P01': 'DSF rejected the password for DSF_DB_USER.',
      '28000': 'DSF refused this login from the API server (pg_hba.conf): check DSF_DB_USER, and try the other DSF_DB_SSL_MODE.',
      '3D000': 'DSF_DB_NAME is not a database on the DSF server.',
      '42P01': 'A DSF table is missing: check DSF_DB_NAME is the DSF (Ignition) database.',
      '42501': 'DSF_DB_USER cannot read the DSF tables: grant it SELECT on them.',
      '53300': 'The DSF server has no free connections.',
      '57P01': 'The DSF server was shutting down.',
    };
    return hints[code] || '';
  }
  /** Why no DSF sources can be chosen, when the API says. */
  get sourceListProblem(): string {
    const problem = this.board?.source_options_problem;
    if (!problem) return '';
    if (problem.reason === 'NO_SOURCES') return 'DSF returned no machine sources in a department named like "Dept. 132".';
    if (problem.reason === 'NO_VALID_SOURCES') return 'DSF returned machine sources, but none had complete identifiers.';
    const code = problem.code ? ' (' + problem.code + ')' : '';
    const hint = this.codeHint(problem.code);
    return 'The DSF source list could not be read: ' + this.failureText(problem.reason) + code + '.' + (hint ? ' ' + hint : '');
  }

  open(row: AdminMappingRow): void {
    this.selectedMachineId = row.machine_id; this.sourceSearch = ''; this.selectedMappingId = row.mapping?.mapping_id || ''; this.error = ''; this.success = '';
    // The editor sits above a long list: bring it into view and move focus to it.
    setTimeout(() => { const el = this.editor?.nativeElement; el?.scrollIntoView({ block: 'start', behavior: 'smooth' }); el?.focus({ preventScroll: true }); });
  }
  close(): void { this.selectedMachineId = null; this.sourceSearch = ''; this.selectedMappingId = ''; }
  choose(option: DsfSourceOption): void { this.selectedMappingId = option.mapping_id; }

  save(): void {
    const row = this.selected; if (!row || !this.selectedMappingId || this.saving) return;
    const option = this.selectedSource; if (!option || option.department !== row.department) return;
    this.saving = true; this.error = ''; this.success = ''; this.cdr.markForCheck();
    this.http.put(`/api/v1/greenshed/dsf-counts/admin-mappings/${encodeURIComponent(row.machine_id)}`, { mapping_id: this.selectedMappingId })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving = false; this.success = `Machine ${row.machine_number} mapped to ${option.whiteboard_name}. A fresh DSF read was requested.`; this.refreshAfterSave(); },
        error: (e: HttpErrorResponse) => { this.saving = false; this.error = this.errorText(e, 'Mapping save failed.'); this.cdr.markForCheck(); },
      });
  }
  unmap(): void {
    const row = this.selected; if (!row || this.saving) return;
    if (!globalThis.confirm(`Unmap the DSF source from machine ${row.machine_number}? DSF counts for this machine stop until a source is selected again.`)) return;
    this.saving = true; this.error = ''; this.success = ''; this.cdr.markForCheck();
    this.http.delete(`/api/v1/greenshed/dsf-counts/admin-mappings/${encodeURIComponent(row.machine_id)}`)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving = false; this.success = `Machine ${row.machine_number} is unmapped. A fresh DSF read was requested.`; this.refreshAfterSave(); },
        error: (e: HttpErrorResponse) => { this.saving = false; this.error = this.errorText(e, 'Unmap failed.'); this.cdr.markForCheck(); },
      });
  }
  private refreshAfterSave(): void { setTimeout(() => this.refresh(false), 1200); this.cdr.markForCheck(); }
  private syncSelected(): void {
    const row = this.selected; if (!row) return;
    this.selectedMappingId = row.mapping?.mapping_id || '';
  }

  classification(row: AdminMappingRow): 'review' | 'mapped' | 'inactive' {
    if (!row.active) return 'inactive';
    if (!row.mapping || ['MAPPING_REVIEW', 'DATA_REVIEW', 'SHIFT_REVIEW'].includes(row.status)) return 'review';
    return 'mapped';
  }
  /** Pill colour: counting is green, anything needing review is amber, a retired machine is red. */
  badgeTone(row: AdminMappingRow): string {
    if (!row.active) return 'inactive';
    if (this.classification(row) === 'review') return 'review';
    if (row.status === 'OK') return 'ok';
    return row.status === 'STALE' ? 'stale' : 'not configured';
  }
  badgeText(row: AdminMappingRow): string {
    if (!row.active) return 'Inactive'; if (!row.mapping) return 'Unmapped';
    if (row.status === 'OK') return row.mapping_origin === 'ADMIN' ? 'Admin mapped' : 'Source verified';
    if (row.status === 'STALE') return 'Source stale'; if (row.status === 'MAPPING_REVIEW') return 'Mapping review';
    if (row.status === 'NOT_CONFIGURED') return 'Not enabled';
    return row.status.replace(/_/g, ' ').toLowerCase();
  }
  writerText(row: AdminMappingRow): string {
    if (!row.active) return '—';
    if (!this.board?.cutter_write_enabled) return 'Off (comparison only)';
    if (!row.mapping) return 'No DSF source';
    if (this.classification(row) === 'review') return 'Not crediting: mapping review';
    if (row.status === 'NOT_CONFIGURED') return 'Not crediting: machine not enabled';
    if (row.writer_status === 'REVIEW') return this.writerReasonText(row.writer_reason);
    if (row.writer_status === 'NO_CHANGE') return row.writer_reason === 'ACTIVATION_BASELINE' ? 'Crediting started' : 'Current, no new pieces';
    if (row.writer_status === 'APPLIED') return 'Count applied';
    if (row.writer_status === 'PENDING_NEW_RUN') return row.writer_reason === 'DSF_READ_PREDATES_SETUP' ? 'Waiting for a read after setup' : 'No active cutter';
    return row.writer_reason === 'NO_FRESH_WRITE' ? 'Waiting for a fresh DSF read' : this.writerReasonText(row.writer_reason);
  }
  private writerReasonText(reason: string): string {
    const text: Record<string, string> = {
      RUN_CHANGED_DURING_WRITE: 'Count changed during update; will retry',
      RUN_CHANGED_OUTSIDE_DSF: 'Cutter count was changed by hand; crediting resumes next shift',
      DANA_WRITE_UNAVAILABLE: 'MeshForge count update unavailable; will retry',
      DSF_COUNT_DECREASE_REVIEW: 'DSF count decreased; review required',
      SOURCE_READ_NOT_FRESH: 'Waiting for a fresh DSF read',
      SHIFT_SCHEDULE_MISMATCH: 'DSF shift does not match the MeshForge shift schedule',
      ACTIVE_RUN_AMBIGUOUS: 'More than one active cutter run; review required',
      COUNT_BELOW_QUALITY_CHECK: 'Cutter count is below its last check; review required',
      API_TIMESTAMP_TIMEZONE_REVIEW: 'The API must run in UTC to credit cutters',
    };
    return text[reason] || reason?.replace(/_/g, ' ').toLowerCase() || 'Review required';
  }
  safeTime(value: string | null | undefined): string { if (!value) return 'not yet'; const t = Date.parse(value); return Number.isFinite(t) ? new Date(t).toLocaleString() : 'not yet'; }
  private errorText(e: HttpErrorResponse, fallback: string): string {
    const message = e?.error?.message; return typeof message === 'string' && message.length < 300 ? message : fallback;
  }
}
