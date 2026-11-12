import { CommonModule, DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  DanaConfirmDialogComponent,
  DanaPageHeaderComponent,
  DanaStatusBadgeDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';
import {
  CutterBuilderApiService,
  CutterRequestRequirement,
  CutterRequestRow,
  cutterApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { canEditMeshForgeApp, canUseMeshForgeAction } from '@meshforge/manufacturing/shared/util-constants';
import { Subject, filter, interval, takeUntil } from 'rxjs';

interface Confirmation { row: CutterRequestRow; status: 'COMPLETED' | 'CANCELED' }
interface BuildLink { id: string; number: string }

@Component({
  selector: 'gear-cutter-requests',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DanaPageHeaderComponent, DanaTableShellDirective, DanaTableDirective, DanaTableEmptyDirective, DanaStatusBadgeDirective, DanaConfirmDialogComponent],
  templateUrl: './cutter-requests.component.html',
  styleUrls: ['./cutter-requests.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CutterRequestsComponent implements OnInit, OnDestroy {
  private readonly api = inject(CutterBuilderApiService);
  private readonly session = inject(AuthSessionService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyed = new Subject<void>();
  private readonly buildLinks = new WeakMap<CutterRequestRow, BuildLink[]>();
  private destroyedPage = false;
  private loadVersion = 0;

  rows: CutterRequestRow[] = [];
  requirements: CutterRequestRequirement[] = [];
  includeCompleted = false;
  loading = false;
  loadingChoices = false;
  busy = false;
  error = '';
  formError = '';
  lookupError = '';
  message = '';
  confirmation: Confirmation | null = null;
  draft = { summary_id: '', part_type_code: '', quantity: 1, notes: '' };

  get canRead(): boolean { return canUseMeshForgeAction(this.session.currentUser, 'cutter-builder:listCutterRequests'); }
  get canCreate(): boolean { return this.canRead && canUseMeshForgeAction(this.session.currentUser, 'cutter-builder:createCutterRequest'); }
  get canUpdate(): boolean { return this.canRead && canUseMeshForgeAction(this.session.currentUser, 'cutter-builder:updateCutterRequestStatus'); }
  get summaries(): Array<{ id: string; label: string }> {
    return [...new Map(this.requirements.map(row => [row.summary_id, {
      id: row.summary_id,
      label: row.summary.revision ? `${row.summary.number} rev ${row.summary.revision}` : row.summary.number,
    }])).values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
  get partTypes(): Array<{ code: string; label: string }> {
    return this.requirements.filter(row => row.summary_id === this.draft.summary_id)
      .map(row => ({ code: row.part_type.code, label: row.part_type.code === 'RING' ? 'Ring' : 'Pinion' }))
      .filter((row, index, rows) => rows.findIndex(value => value.code === row.code) === index);
  }
  get quantityValid(): boolean { return Number.isInteger(Number(this.draft.quantity)) && Number(this.draft.quantity) >= 1 && Number(this.draft.quantity) <= 99; }
  get requestedTotal(): number { return this.rows.reduce((sum, row) => sum + Number(row.requested_quantity), 0); }
  get builtTotal(): number { return this.rows.reduce((sum, row) => sum + Number(row.built_quantity), 0); }
  get remainingTotal(): number { return this.rows.reduce((sum, row) => sum + Number(row.remaining_quantity), 0); }
  get lookupRoute(): string { return this.router.url.startsWith('/greenshed') ? '/greenshed/lookup' : '/cutter-builder/lookup'; }
  get canOpenBuild(): boolean {
    const user = this.session.currentUser;
    if (!user) return false;
    const greenshed = this.lookupRoute.startsWith('/greenshed');
    return canEditMeshForgeApp(greenshed ? 'GREENSHED' : 'CUTTER_BUILDER', user.role, user.departmentCode, user.permissions)
      && canUseMeshForgeAction(user, greenshed ? 'greenshed:getBuild' : 'cutter-builder:getBuild');
  }

  ngOnInit(): void {
    if (!this.canRead) return;
    this.refresh();
    if (this.canCreate) this.loadChoices();
    interval(30_000).pipe(
      filter(() => this.document.visibilityState !== 'hidden' && !this.loading && !this.busy && !this.confirmation),
      takeUntil(this.destroyed),
    ).subscribe(() => this.refresh());
  }

  ngOnDestroy(): void {
    this.destroyedPage = true;
    ++this.loadVersion;
    this.destroyed.next();
    this.destroyed.complete();
  }

  refresh(): void {
    if (!this.canRead || this.busy) return;
    const version = ++this.loadVersion;
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    this.api.listCutterRequests(this.includeCompleted).pipe(takeUntil(this.destroyed)).subscribe({
      next: rows => { if (version !== this.loadVersion) return; this.rows = rows; this.loading = false; this.cdr.markForCheck(); },
      error: (error: HttpErrorResponse) => {
        if (version !== this.loadVersion) return;
        this.loading = false;
        this.error = cutterApiErrorText(error, 'Could not load cutter requests. Refresh to try again.');
        this.cdr.markForCheck();
      },
    });
  }

  loadChoices(): void {
    if (!this.canCreate || this.loadingChoices || this.busy) return;
    this.loadingChoices = true;
    this.lookupError = '';
    this.cdr.markForCheck();
    this.api.getCutterRequestRequirements().pipe(takeUntil(this.destroyed)).subscribe({
      next: rows => {
        this.requirements = rows.filter(row => row.enabled !== false && row.summary?.enabled !== false && row.summary?.active !== false
          && row.part_type?.enabled !== false && ['RING', 'PINION'].includes(row.part_type?.code));
        this.loadingChoices = false;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.loadingChoices = false;
        const message = cutterApiErrorText(error, 'Could not load Part Summary and Part Type choices.');
        this.lookupError = error.status === 403 ? `${message} Ask an administrator to allow blade-requirement lookups for your role.` : message;
        this.cdr.markForCheck();
      },
    });
  }

  summaryChanged(): void { this.draft.part_type_code = ''; this.formError = ''; }

  create(): void {
    if (this.busy || !this.canCreate) return;
    this.formError = '';
    if (!this.draft.summary_id || !this.partTypes.some(type => type.code === this.draft.part_type_code)) {
      this.formError = 'Choose an available Part Summary and its Part Type.';
      return;
    }
    if (!this.quantityValid) { this.formError = 'Quantity must be a whole number from 1 to 99 cutters.'; return; }
    if (this.draft.notes.length > 2000) { this.formError = 'Notes must be 2,000 characters or fewer.'; return; }
    const payload = { summary_id: this.draft.summary_id, part_type_code: this.draft.part_type_code, quantity: Number(this.draft.quantity), notes: this.draft.notes.trim() || null };
    this.busy = true;
    this.message = '';
    this.cdr.markForCheck();
    this.api.createCutterRequest(payload).pipe(takeUntil(this.destroyed)).subscribe({
      next: () => {
        if (this.destroyedPage) return;
        this.busy = false;
        this.draft = { summary_id: '', part_type_code: '', quantity: 1, notes: '' };
        this.message = 'Cutter request saved.';
        this.refresh();
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.busy = false;
        this.formError = cutterApiErrorText(error, 'Could not save the request. Your entries have been kept.');
        this.cdr.markForCheck();
      },
    });
  }

  terminal(row: CutterRequestRow): boolean { return row.status === 'COMPLETED' || row.status === 'CANCELED'; }
  statusLabel(row: CutterRequestRow): string { return ({ REQUESTED: 'Requested', IN_PROGRESS: 'In Progress', READY: 'Ready', COMPLETED: 'Completed', CANCELED: 'Canceled' })[row.status] ?? row.status; }
  statusTone(row: CutterRequestRow): string { return row.status === 'READY' || row.status === 'COMPLETED' ? 'success' : row.status === 'IN_PROGRESS' ? 'warning' : 'neutral'; }
  builds(row: CutterRequestRow): BuildLink[] {
    const cached = this.buildLinks.get(row);
    if (cached) return cached;
    // API rows are snapshots. Keep their projection stable so the table's mutation observer
    // does not see replacement links on every change-detection pass.
    const ids = row.build_ids ?? [], numbers = row.build_numbers ?? [];
    const links = row.builds?.length
      ? row.builds.map(build => ({ id: build.id, number: build.build_number || build.id }))
      : Array.from({ length: Math.max(ids.length, numbers.length) }, (_, index) => ({
        id: ids[index] || numbers[index], number: numbers[index] || ids[index],
      }));
    this.buildLinks.set(row, links);
    return links;
  }
  trackRequest(_index: number, row: CutterRequestRow): string { return row.id; }
  trackBuild(_index: number, build: BuildLink): string { return build.id; }
  trackSummary(_index: number, summary: { id: string }): string { return summary.id; }
  trackPartType(_index: number, type: { code: string }): string { return type.code; }
  askStatus(row: CutterRequestRow, status: 'COMPLETED' | 'CANCELED'): void {
    if (this.busy || !this.canUpdate || this.terminal(row) || (status === 'COMPLETED' && row.status !== 'READY')) return;
    this.confirmation = { row, status };
  }
  get confirmationMessage(): string {
    if (!this.confirmation) return '';
    return this.confirmation.status === 'COMPLETED'
      ? `Mark the ready request for ${this.confirmation.row.summary_number} / ${this.confirmation.row.part_type_code} completed? This does not move a cutter or change inventory.`
      : `Cancel the remaining request for ${this.confirmation.row.summary_number} / ${this.confirmation.row.part_type_code}? Existing build links and physical cutter inventory are kept.`;
  }
  applyStatus(): void {
    const confirmation = this.confirmation;
    if (!confirmation || this.busy || !this.canUpdate) return;
    this.confirmation = null;
    this.busy = true;
    this.error = '';
    this.message = '';
    this.cdr.markForCheck();
    this.api.updateCutterRequestStatus(confirmation.row.id, confirmation.status).pipe(takeUntil(this.destroyed)).subscribe({
      next: () => { this.busy = false; this.message = confirmation.status === 'COMPLETED' ? 'Request completed.' : 'Request canceled.'; this.refresh(); this.cdr.markForCheck(); },
      error: (error: HttpErrorResponse) => { this.busy = false; this.error = cutterApiErrorText(error, 'Could not update the request. Refresh to check its current status.'); this.cdr.markForCheck(); },
    });
  }
}
