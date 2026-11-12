import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  GearToastService,
  OptionPickerComponent,
  PickerOption,
  ScanPanelComponent,
  StationStatusComponent,
  createStatusLine,
  heldScanIgnoredText,
} from '@meshforge/manufacturing/frontend/util-common';
import {
  buildSummaryShelfTag,
  normalizeSummaryNumber,
} from '@meshforge/manufacturing/shared/util-constants';
import { ILocation } from '@meshforge/manufacturing/shared/util-types';
import {
  GreenshedApiService,
  GreenshedBuild,
  GreenshedPullResult,
  GreenshedReferenceData,
  greenshedApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { DanaConfirmDialogComponent, DanaPageHeaderComponent } from '@dana/ui';

@Component({
  selector: 'gear-greenshed-pull',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DanaPageHeaderComponent,
    DanaConfirmDialogComponent,
    ScanPanelComponent,
    StationStatusComponent,
    OptionPickerComponent,
  ],
  templateUrl: './greenshed-pull.component.html',
  styleUrl: '../station-page.css',
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
  /** Readable name of the reason on the last completed pull (the API result carries only its code). */
  resultReasonName = '';
  shelfSerial = '';
  shelf: ILocation | null = null;
  comments = '';
  busy = false;

  /** The request that owns `busy`; a stale response never leaves the page busy, nor clears a newer request. */
  private busyOwner = 0;
  private beginBusy(): number {
    this.busy = true;
    return ++this.busyOwner;
  }
  private endBusy(owner: number): void {
    if (owner === this.busyOwner) this.busy = false;
  }
  private resetBusy(): void {
    this.busyOwner++;
    this.busy = false;
  }
  contextValid = false;
  lockedToRunningMachine = false;
  error = '';
  message = '';
  result: GreenshedPullResult | null = null;

  /** The pull reasons could not be loaded; a pull cannot be recorded until they are. */
  refsError = '';

  ngOnInit(): void {
    this.refreshChoices();
    this.loadReferenceData();
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        ++this.generation;
        ++this.shelfRequest;
        this.resetBusy();
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
  loadReferenceData(): void {
    this.refsError = '';
    this.api
      .getReferenceData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (refs) => {
          this.refs = refs;
          this.setRequestedReason();
        },
        error: (e: HttpErrorResponse) =>
          (this.refsError = greenshedApiErrorText(
            e,
            'Could not load pull reasons.',
          )),
      });
  }

  // ---- Station layout: numbered scan-or-pick steps, one status line, a reason on a blocked action ----

  private readonly statusLine = createStatusLine();
  /** Shown when there is no error or result: e.g. a scan made too early. */
  notice = '';
  get status() {
    return this.statusLine(this.error, this.message, this.notice);
  }
  dismissStatus(): void {
    this.error = '';
    this.message = '';
    this.notice = '';
  }
  scanIgnored(scan: string): void {
    if (!this.error) this.notice = heldScanIgnoredText(scan);
  }

  get buildOptions(): PickerOption[] {
    return this.availableRunningBuilds.map((row) => ({
      value: row.build_number,
      cells: [row.build_number, `Machine ${row.machine_number}`, `${row.summary_number} ${row.part_type_code}`],
    }));
  }
  get shelfOptions(): PickerOption[] {
    const serial = this.expectedShelfSerial;
    return serial ? [{ value: serial, cells: [serial, `Exact ${this.build?.summary_number} ${this.build?.part_type_code} shelf`] }] : [];
  }

  /** What to do next, shown in the status line when there is no message. */
  get prompt(): string {
    if (this.busy) return 'Working…';
    if (this.result) return 'Pull recorded. Tap Pull Another Cutter for the next one.';
    if (!this.build || !this.contextValid) {
      return this.lockedToRunningMachine ? 'Checking the cutter chosen on Running Machines…' : 'Scan or choose the active cutter to pull.';
    }
    if (!this.reason) return 'Choose the pull reason.';
    if (this.reason.returns_to_shelf && !this.shelf) return this.expectedShelfSerial ? `Scan the Green Shed shelf ${this.expectedShelfSerial}.` : 'Scan the Green Shed shelf.';
    return 'Check the destination, then tap Pull Cutter.';
  }

  /** Why Pull Cutter is not available, in operator terms. Empty when it is (or while working). */
  get pullBlockedReason(): string {
    if (this.busy || this.pullReady) return '';
    if (!this.build || !this.contextValid) return 'Scan or choose the active cutter first (step 1).';
    if (this.build.status_code !== 'RUNNING') return `Build ${this.build.build_number} is not RUNNING.`;
    if (!this.reason) return 'Choose the pull reason (step 2).';
    if (this.reason.returns_to_shelf && !this.shelf) return `Scan its Green Shed shelf${this.expectedShelfSerial ? ' ' + this.expectedShelfSerial : ''} (step 3).`;
    return '';
  }

  /** A build scanned or picked: the same lookup and run checks as before. */
  useBuild(value: string): void {
    if (this.busy || this.lockedToRunningMachine || !value.trim()) return;
    this.notice = '';
    this.buildNumber = value.trim();
    this.scanBuild();
  }
  changeBuild(): void {
    if (this.busy || this.lockedToRunningMachine) return;
    this.buildNumber = '';
    this.onBuildInput();
  }
  useShelf(value: string): void {
    if (this.busy || !value.trim()) return;
    this.notice = '';
    this.shelfSerial = value.trim();
    this.scanShelf();
  }
  changeShelf(): void {
    if (this.busy) return;
    this.shelfSerial = '';
    this.onShelfInput();
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
        // No requested reason: the operator chooses. Defaulting to the first reason in the list
        // would preselect a teardown disposition for what may be an intact changeover.
        : '';
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
    const owner = this.beginBusy();
    this.api
      .getBuild(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (build) => {
          this.endBusy(owner);
          if (generation !== this.generation) return;
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
          this.endBusy(owner);
          if (generation !== this.generation) return;
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
    const owner = this.beginBusy();
    this.api
      .scanLocation(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (shelf) => {
          this.endBusy(owner);
          if (
            request !== this.shelfRequest ||
            build !== this.build ||
            reason !== this.reason
          )
            return;
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
          this.endBusy(owner);
          if (request !== this.shelfRequest) return;
          this.error = greenshedApiErrorText(e, 'Shelf location not found.');
        },
      });
  }
  onReasonChange(): void {
    this.pullConfirmation = false;
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
    this.error = this.message = this.notice = '';
    this.resetPullDownstream();
  }
  private resetPullDownstream(): void {
    this.pullConfirmation = false;
    ++this.shelfRequest;
    this.shelfSerial = '';
    this.shelf = null;
    this.comments = '';
    this.result = null;
  }
  /** The pull is waiting for the operator to confirm it in the dialog. */
  pullConfirmation = false;
  /** Everything a pull needs is selected and validated. */
  get pullReady(): boolean {
    const build = this.build,
      reason = this.reason;
    return Boolean(
      !this.busy &&
        this.contextValid &&
        build?.machine_run &&
        reason &&
        build.status_code === 'RUNNING' &&
        (!reason.returns_to_shelf || this.shelf),
    );
  }
  get pullConfirmationMessage(): string {
    const build = this.build,
      reason = this.reason;
    if (!build?.machine_run || !reason) return '';
    const destination = reason.returns_to_shelf
      ? (this.shelf?.serial_number ?? 'selected shelf')
      : 'Cutter Builder';
    return `Machine ${build.machine_run.machine_number} · Reason: ${reason.name} · Destination: ${destination}. This records the cutter pull transaction.`;
  }
  /** Pull Cutter asks first; nothing is recorded until the operator confirms. */
  pull(): void {
    if (this.pullReady) this.pullConfirmation = true;
  }
  confirmPull(): void {
    this.pullConfirmation = false;
    const build = this.build,
      run = build?.machine_run,
      reason = this.reason,
      shelf = this.shelf;
    // Revalidate: the selection may have changed while the dialog was open.
    if (!this.pullReady || !build || !run || !reason) return;
    const generation = this.generation;
    const owner = this.beginBusy();
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
          this.endBusy(owner);
          if (generation !== this.generation) return;
          this.result = result;
          this.resultReasonName = reason.name;
          this.contextValid = false;
          const message = reason.returns_to_shelf
            ? `Cutter returned intact to ${shelf?.serial_number}.`
            : 'Cutter pulled and is ready to return to Cutter Builder.';
          this.message = message;
          this.toast.success(message, 'Cutter pull complete');
          this.refreshChoices();
        },
        error: (e: HttpErrorResponse) => {
          this.endBusy(owner);
          if (generation !== this.generation) return;
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
