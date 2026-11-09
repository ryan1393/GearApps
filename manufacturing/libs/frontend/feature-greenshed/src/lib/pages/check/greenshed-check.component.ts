import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GearToastService } from '@libs/frontend/util-common';
import {
  GreenshedApiService, GreenshedBuild, GreenshedReferenceData,
  FREQUENCY_MEASUREMENT_FIELDS, CMM_MEASUREMENT_FIELDS,
  FrequencyMeasurements, CmmMeasurements, greenshedApiErrorText,
} from '@libs/frontend/data-access-greenshed';
import { DanaPageHeaderComponent } from '@dana/ui';

@Component({
  selector: 'gear-greenshed-check', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DanaPageHeaderComponent],
  templateUrl: './greenshed-check.component.html',
  styles: [`
    .quality-check-layout{display:grid;gap:1rem}
    .quality-check-summary{grid-template-columns:repeat(4,minmax(0,1fr))}
    .check-measurements{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;margin:1.25rem 0}
    .check-measurements input{width:100%;min-width:0}
    h3{font-size:1rem;font-weight:700;margin:1.5rem 0 .75rem}
    fieldset{border:0;padding:0;margin:0;min-width:0}
    .check-result-actions{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-top:1rem}
    @media(max-width:900px){.check-measurements,.quality-check-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:480px){.check-measurements,.quality-check-summary{grid-template-columns:1fr}}
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
    this.api.getReferenceData().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => this.refs = r,
      error: (e: HttpErrorResponse) => this.error = greenshedApiErrorText(e, 'Could not load check choices.'),
    });
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
          this.pieceCount = Math.max(run.current_piece_count, run.next_check_piece_count);
        }
      },
      error: (e: HttpErrorResponse) => {
        if (generation !== this.generation) return;
        this.busy = false;
        this.error = greenshedApiErrorText(e, 'Build not found.');
      },
    });
  }

  save(): void {
    const build = this.build;
    const run = build?.machine_run;
    if (this.busy || !this.contextValid || !build || !run) return;
    if (this.checkFormElement && !this.checkFormElement.nativeElement.checkValidity()) {
      this.error = 'Correct the highlighted count or measurement before saving.';
      this.checkFormElement.nativeElement.reportValidity();
      return;
    }
    const values = this.checkType === 'FC' ? this.frequency : this.cmm;
    if (this.pieceCount === null || !Number.isSafeInteger(this.pieceCount) || this.pieceCount < run.current_piece_count ||
      Object.values(values).some(value => value != null && !Number.isFinite(value))) {
      this.error = 'Enter a whole piece count at or above the current count and valid measurement numbers.';
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
