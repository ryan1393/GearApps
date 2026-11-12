import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GearScannerFocusDirective, GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import {
  GreenshedApiService, GreenshedBuild, GreenshedReferenceData,
  FREQUENCY_MEASUREMENT_FIELDS, CMM_MEASUREMENT_FIELDS,
  FrequencyMeasurements, CmmMeasurements, greenshedApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { DanaPageHeaderComponent } from '@dana/ui';

@Component({
  selector: 'gear-greenshed-check', standalone: true,
  imports: [CommonModule, GearScannerFocusDirective, FormsModule, RouterLink, DanaPageHeaderComponent],
  templateUrl: './greenshed-check.component.html',
  styles: [`
    .quality-check-entry{display:grid;gap:var(--dana-form-gap);border:0;padding:0;margin:0;min-width:0}
    .check-measurement-heading{margin:0}
  `],
})
export class GreenshedCheckComponent implements OnInit {
  private readonly api = inject(GreenshedApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(GearToastService);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private requestedType: 'FC' | 'CMM' = 'FC';
  private selectedContext: { build: string; machine: string; run: string | null } | null = null;
  @ViewChild('checkFormElement') private checkFormElement?: ElementRef<HTMLFormElement>;

  refs: GreenshedReferenceData | null = null;
  loadingChoices = false;
  choicesError = '';
  build: GreenshedBuild | null = null;
  buildNumber = '';
  availableRunningBuilds: Array<{build_number:string;machine_number:string;summary_number:string;part_type_code:string;check_due:boolean}> = [];
  pieceCount: number | null = 0;
  checkType: 'FC' | 'CMM' = 'FC';
  resultCode = 'PASS';
  comments = '';
  frequency: FrequencyMeasurements = {};
  cmm: CmmMeasurements = {};
  readonly frequencyFields = FREQUENCY_MEASUREMENT_FIELDS;
  readonly cmmFields = CMM_MEASUREMENT_FIELDS;
  busy = false;
  contextValid = false;
  lockedToRunningMachine = false;
  error = '';
  message = '';

  ngOnInit(): void {
    this.api.getDashboard().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => this.availableRunningBuilds = d.active_machines,
      error: () => this.availableRunningBuilds = [],
    });
    this.loadChoices();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      ++this.generation;
      this.busy = false;
      this.build = null;
      this.contextValid = false;
      this.error = this.message = '';
      this.requestedType = params.get('type')?.toUpperCase() === 'CMM' ? 'CMM' : 'FC';
      this.buildNumber = params.get('build')?.trim().toUpperCase() || '';
      this.lockedToRunningMachine = params.get('origin') === 'running-machines';
      this.selectedContext = this.lockedToRunningMachine ? {
        build: this.buildNumber,
        machine: params.get('machine')?.trim().toUpperCase() || '',
        run: params.get('run')?.trim() || null,
      } : null;
      this.resetCheckEntry();
      if (this.lockedToRunningMachine && (!this.selectedContext?.build || !this.selectedContext.machine)) {
        this.error = 'Select a machine and check from Running Machines again.';
      } else if (this.buildNumber) {
        this.scan();
      }
    });
  }

  loadChoices(): void {
    if (this.loadingChoices || this.refs) return;
    this.loadingChoices = true;
    this.choicesError = '';
    this.api.getReferenceData().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: refs => {
        this.refs = refs;
        this.loadingChoices = false;
        this.initializePieceCount();
      },
      error: (error: HttpErrorResponse) => {
        this.loadingChoices = false;
        this.choicesError = greenshedApiErrorText(error, 'Could not load check choices.');
      },
    });
  }

  /** Both the validated run and its count source are needed before choosing the default. */
  private initializePieceCount(): void {
    const run = this.build?.machine_run;
    if (!this.refs || !this.contextValid || !run) return;
    // Operator-counted checks advance the running count. DSF-counted checks start at
    // the scheduled point (or live count for an early check) without moving that count.
    this.pieceCount = this.dsfCounts
      ? Math.max(run.last_check_piece_count, Math.min(run.next_check_piece_count, run.current_piece_count))
      : Math.max(run.current_piece_count, run.next_check_piece_count);
  }

  onBuildInput(): void { if (this.busy || this.lockedToRunningMachine) return; ++this.generation; this.build = null; this.contextValid = false; this.resetCheckEntry(); this.error = ''; }

  selectBuild(): void { if (!this.lockedToRunningMachine) this.scan(); }

  scan(): void {
    if (this.busy) return;
    const value = (this.selectedContext?.build || this.buildNumber).trim();
    const generation = ++this.generation;
    this.build = null;
    this.contextValid = false;
    this.error = this.message = '';
    this.resetCheckEntry(true);
    if (!value) return;
    this.busy = true;
    this.api.getBuild(value).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: b => {
        if (generation !== this.generation) return;
        this.busy = false;
        this.build = b;
        this.buildNumber = b.build_number;
        const run = b.machine_run;
        if (b.status_code !== 'RUNNING' || !run) {
          this.error = 'Build ' + b.build_number + ' is not RUNNING.';
        } else if (this.selectedContext && (
          b.build_number.toUpperCase() !== this.selectedContext.build ||
          run.machine_number.toUpperCase() !== this.selectedContext.machine ||
          (this.selectedContext.run && run.id !== this.selectedContext.run)
        )) {
          this.build = null;
          this.buildNumber = this.selectedContext.build;
          this.error = 'The selected cutter or machine run has changed. Select the check from Running Machines again.';
        } else {
          this.contextValid = true;
          this.initializePieceCount();
        }
      },
      error: (e: HttpErrorResponse) => {
        if (generation !== this.generation) return;
        this.busy = false;
        this.error = greenshedApiErrorText(e, 'Build not found.');
      },
    });
  }

  /** True when DSF credits production to cutters, so the running count moves without a check. */
  get dsfCounts(): boolean { return this.refs?.dsf_cutter_counts === true; }

  /** Lowest piece count a check may be recorded at. */
  get minimumPieceCount(): number {
    const run = this.build?.machine_run;
    if (!run) return 0;
    return this.dsfCounts ? run.last_check_piece_count : run.current_piece_count;
  }

  save(): void {
    const build = this.build;
    const run = build?.machine_run;
    if (this.busy || !this.refs || this.loadingChoices || !this.contextValid || !build || !run) return;
    if (this.checkFormElement && !this.checkFormElement.nativeElement.checkValidity()) {
      this.error = 'Correct the highlighted count or measurement before saving.';
      this.checkFormElement.nativeElement.reportValidity();
      return;
    }
    const values = this.checkType === 'FC' ? this.frequency : this.cmm;
    if (this.pieceCount === null || !Number.isSafeInteger(this.pieceCount) || this.pieceCount < this.minimumPieceCount ||
      Object.values(values).some(value => value != null && !Number.isFinite(value))) {
      this.error = this.dsfCounts
        ? `Enter a whole piece count at or above the previous check count (${run.last_check_piece_count}) and valid measurement numbers.`
        : 'Enter a whole piece count at or above the current count and valid measurement numbers.';
      return;
    }
    const generation = this.generation;
    this.busy = true;
    this.error = this.message = '';
    this.api.qualityCheck({
      buildNumber: build.build_number, checkTypeCode: this.checkType,
      resultCode: this.resultCode, pieceCount: this.pieceCount, comments: this.comments,
      expectedMachineNumber: run.machine_number, expectedMachineRunId: run.id,
      frequency: this.checkType === 'FC' ? this.frequency : undefined,
      cmm: this.checkType === 'CMM' ? this.cmm : undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        if (generation !== this.generation) return;
        this.busy = false;
        run.current_piece_count = r.piece_count;
        run.last_check_piece_count = r.piece_count;
        run.next_check_piece_count = r.next_check_piece_count;
        this.resetCheckEntry(true);
        this.pieceCount = r.next_check_piece_count;
        this.message = r.check_type_code + ' ' + r.result_code + ' saved at piece ' + r.piece_count + '. Next check: ' + r.next_check_piece_count + '.';
        if (r.result_code === 'PASS') this.toast.success(this.message, 'Quality check saved');
        else this.toast.warning(this.message + ' Review whether the cutter needs to be pulled.', 'Quality check needs attention');
      },
      error: (e: HttpErrorResponse) => {
        if (generation !== this.generation) return;
        this.busy = false;
        this.error = greenshedApiErrorText(e, 'Could not save check.');
        this.toast.error(this.error, 'Quality check failed');
      },
    });
  }

  resetCheckEntry(preserveType = false): void {
    this.resultCode = 'PASS';
    this.comments = '';
    this.frequency = {};
    this.cmm = {};
    this.pieceCount = Math.max(this.build?.machine_run?.current_piece_count ?? 0, this.build?.machine_run?.next_check_piece_count ?? 0);
    if (!preserveType) this.checkType = this.requestedType;
  }

  startAnother(): void {
    if (this.busy || this.lockedToRunningMachine) return;
    ++this.generation;
    this.build = null;
    this.buildNumber = '';
    this.contextValid = false;
    this.resetCheckEntry();
    this.error = this.message = '';
  }
}
