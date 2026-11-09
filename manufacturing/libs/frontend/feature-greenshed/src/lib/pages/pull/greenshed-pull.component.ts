import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { GearToastService } from '@gearapps/manufacturing/frontend/util-common';
import {
  buildSummaryShelfTag,
  normalizeSummaryNumber,
} from '@gearapps/manufacturing/shared/util-constants';
import { ILocation } from '@gearapps/manufacturing/shared/util-types';
import {
  GreenshedApiService,
  GreenshedBuild,
  GreenshedPullResult,
  GreenshedReferenceData,
  greenshedApiErrorText,
} from '@gearapps/manufacturing/frontend/data-access-greenshed';
import { DanaPageHeaderComponent } from '@dana/ui';

@Component({
  selector: 'gear-greenshed-pull',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaPageHeaderComponent],
  templateUrl: './greenshed-pull.component.html',
})
export class GreenshedPullComponent implements OnInit {
  private readonly api = inject(GreenshedApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(GearToastService);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private shelfRequest = 0;
  private requestedReason = '';
  private selectedContext: {
    build: string;
    machine: string;
    run: string | null;
  } | null = null;
  refs: GreenshedReferenceData | null = null;
  build: GreenshedBuild | null = null;
  buildNumber = '';
  availableRunningBuilds: Array<{
    build_number: string;
    machine_number: string;
    summary_number: string;
    part_type_code: string;
  }> = [];
  reasonCode = '';
  shelfSerial = '';
  shelf: ILocation | null = null;
  comments = '';
  busy = false;
  contextValid = false;
  lockedToRunningMachine = false;
  error = '';
  message = '';
  result: GreenshedPullResult | null = null;

  ngOnInit(): void {
    this.refreshChoices();
    this.api
      .getReferenceData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (refs) => {
          this.refs = refs;
          this.setRequestedReason();
        },
        error: (e: HttpErrorResponse) =>
          (this.error = greenshedApiErrorText(
            e,
            'Could not load pull reasons.',
          )),
      });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        ++this.generation;
        ++this.shelfRequest;
        this.busy = false;
        this.lockedToRunningMachine =
          params.get('origin') === 'running-machines';
        this.buildNumber = params.get('build')?.trim().toUpperCase() || '';
        this.selectedContext = this.lockedToRunningMachine
          ? {
              build: this.buildNumber,
              machine: params.get('machine')?.trim().toUpperCase() || '',
              run: params.get('run')?.trim() || null,
            }
          : null;
        this.requestedReason = params.get('reason')?.trim().toUpperCase() || '';
        this.build = null;
        this.contextValid = false;
        this.error = this.message = '';
        this.resetPullDownstream();
        this.setRequestedReason();
        if (
          this.lockedToRunningMachine &&
          (!this.selectedContext?.build || !this.selectedContext.machine)
        )
          this.error = 'Select a cutter from Running Machines again.';
        else if (this.buildNumber) this.scanBuild();
      });
  }
  private refreshChoices(): void {
    this.api
      .getDashboard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => (this.availableRunningBuilds = d.active_machines),
        error: () => (this.availableRunningBuilds = []),
      });
  }
  private setRequestedReason(): void {
    if (!this.refs) return;
    const changeover = this.refs.pull_reasons.find(
      (x) => x.returns_to_shelf && !x.requires_teardown,
    );
    this.reasonCode = this.refs.pull_reasons.some(
      (x) => x.code === this.requestedReason,
    )
      ? this.requestedReason
      : this.requestedReason === 'CHANGEOVER'
        ? (changeover?.code ?? '')
        : (this.refs.pull_reasons[0]?.code ?? '');
  }
  get expectedShelfSerial(): string | null {
    return this.build
      ? buildSummaryShelfTag(
          'GREENSHED',
          this.build.summary_number,
          this.build.part_type_code,
        )
      : null;
  }
  get reason() {
    return (
      this.refs?.pull_reasons.find((x) => x.code === this.reasonCode) ?? null
    );
  }
  onBuildInput(): void {
    if (this.busy || this.lockedToRunningMachine) return;
    ++this.generation;
    this.build = null;
    this.contextValid = false;
    this.resetPullDownstream();
    this.error = '';
  }
  onShelfInput(): void {
    if (this.busy) return;
    ++this.shelfRequest;
    this.shelf = null;
    this.result = null;
    this.error = '';
  }
  selectBuild(): void {
    if (!this.busy && !this.lockedToRunningMachine) this.scanBuild();
  }
  selectShelf(): void {
    if (!this.busy) this.scanShelf();
  }
  scanBuild(): void {
    if (this.busy) return;
    const value = (this.selectedContext?.build || this.buildNumber).trim();
    const generation = ++this.generation;
    this.build = null;
    this.contextValid = false;
    this.resetPullDownstream();
    this.error = this.message = '';
    if (!value) return;
    this.busy = true;
    this.api
      .getBuild(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (build) => {
          if (generation !== this.generation) return;
          this.busy = false;
          const run = build.machine_run;
          if (build.status_code !== 'RUNNING' || !run) {
            this.error = `Build ${build.build_number} is not RUNNING.`;
            return;
          }
          if (
            this.selectedContext &&
            (build.build_number.toUpperCase() !== this.selectedContext.build ||
              run.machine_number.toUpperCase() !==
                this.selectedContext.machine ||
              (this.selectedContext.run && run.id !== this.selectedContext.run))
          ) {
            this.error =
              'The selected cutter or machine run has changed. Select the pull from Running Machines again.';
            return;
          }
          this.build = build;
          this.buildNumber = build.build_number;
          this.contextValid = true;
        },
        error: (e: HttpErrorResponse) => {
          if (generation !== this.generation) return;
          this.busy = false;
          this.error = greenshedApiErrorText(e, 'Build not found.');
        },
      });
  }
  scanShelf(): void {
    if (this.busy) return;
    const value = this.shelfSerial.trim(),
      build = this.build,
      reason = this.reason;
    const request = ++this.shelfRequest;
    this.shelf = null;
    this.error = '';
    if (!value || !build || !reason?.returns_to_shelf) return;
    this.busy = true;
    this.api
      .scanLocation(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (shelf) => {
          if (
            request !== this.shelfRequest ||
            build !== this.build ||
            reason !== this.reason
          )
            return;
          this.busy = false;
          const expected = buildSummaryShelfTag(
            'GREENSHED',
            build.summary_number,
            build.part_type_code,
          );
          if (
            !expected ||
            shelf.location_type !== 'SHELF' ||
            shelf.department !== 'GREENSHED' ||
            shelf.number !== normalizeSummaryNumber(build.summary_number) ||
            shelf.serial_number !== expected
          ) {
            this.error = expected
              ? `Summary ${build.summary_number} cutter must go to ${expected}.`
              : 'Scan the cutter build before scanning its Green Shed shelf.';
            return;
          }
          this.shelf = shelf;
          this.shelfSerial = shelf.serial_number;
        },
        error: (e: HttpErrorResponse) => {
          if (request !== this.shelfRequest) return;
          this.busy = false;
          this.error = greenshedApiErrorText(e, 'Shelf location not found.');
        },
      });
  }
  onReasonChange(): void {
    ++this.shelfRequest;
    this.shelfSerial = '';
    this.shelf = null;
    this.result = null;
    this.message = '';
  }
  reset(): void {
    if (this.busy) return;
    ++this.generation;
    ++this.shelfRequest;
    this.selectedContext = null;
    this.lockedToRunningMachine = false;
    this.build = null;
    this.contextValid = false;
    this.buildNumber = '';
    this.error = this.message = '';
    this.resetPullDownstream();
  }
  private resetPullDownstream(): void {
    ++this.shelfRequest;
    this.shelfSerial = '';
    this.shelf = null;
    this.comments = '';
    this.result = null;
  }
  pull(): void {
    const build = this.build,
      run = build?.machine_run,
      reason = this.reason,
      shelf = this.shelf;
    if (
      this.busy ||
      !this.contextValid ||
      !build ||
      !run ||
      !reason ||
      build.status_code !== 'RUNNING' ||
      (reason.returns_to_shelf && !shelf)
    )
      return;
    const destination = reason.returns_to_shelf
      ? (shelf?.serial_number ?? 'selected shelf')
      : 'Cutter Builder';
    if (
      !globalThis.confirm(
        `Pull cutter ${build.build_number}?\n\nMachine: ${run.machine_number}\nReason: ${reason.name}\nDestination: ${destination}\n\nThis records the cutter pull transaction.`,
      )
    )
      return;
    const generation = this.generation;
    this.busy = true;
    this.error = '';
    this.api
      .pullCutter({
        buildNumber: build.build_number,
        reasonCode: reason.code,
        shelfLocationSerial: reason.returns_to_shelf
          ? (shelf?.serial_number ?? null)
          : null,
        comments: this.comments,
        expectedMachineNumber: run.machine_number,
        expectedMachineRunId: run.id,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (generation !== this.generation) return;
          this.busy = false;
          this.result = result;
          this.contextValid = false;
          const message = reason.returns_to_shelf
            ? `Cutter returned intact to ${shelf?.serial_number}.`
            : 'Cutter pulled and is ready to return to Cutter Builder.';
          this.message = '';
          this.toast.success(message, 'Cutter pull complete');
          this.refreshChoices();
        },
        error: (e: HttpErrorResponse) => {
          if (generation !== this.generation) return;
          this.busy = false;
          const message = greenshedApiErrorText(e, 'Could not pull cutter.');
          this.error = message;
          this.toast.error(message, 'Cutter pull failed');
          if (e.status === 409 || e.status === 404) {
            this.contextValid = false;
            this.build = null;
            this.resetPullDownstream();
          }
        },
      });
  }
}
