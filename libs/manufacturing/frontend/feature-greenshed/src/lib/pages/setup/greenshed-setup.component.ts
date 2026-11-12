import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject } from '@angular/core';
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
  GreenshedApiService,
  GreenshedBuild,
  GreenshedMachine,
  GreenshedSetupResult,
  PartMasterRow,
  greenshedApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { DanaPageHeaderComponent, DanaButtonDirective } from '@dana/ui';

@Component({
  selector: 'gear-greenshed-setup',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DanaPageHeaderComponent,
    DanaButtonDirective,
    ScanPanelComponent,
    StationStatusComponent,
    OptionPickerComponent,
  ],
  templateUrl: './greenshed-setup.component.html',
  styleUrl: '../station-page.css',
})
export class GreenshedSetupComponent {
  private readonly api = inject(GreenshedApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(GearToastService);
  private readonly destroyRef = inject(DestroyRef);
  private selectedMachineNumber = '';
  private buildRequest = 0;
  private machineRequest = 0;
  private partRequest = 0;
  private choicesRequest = 0;
  buildNumber = '';
  machineNumber = '';
  partNumber = '';
  startingPieceCount = 0;
  comments = '';
  availableBuilds: Array<
    Pick<GreenshedBuild, 'build_number' | 'summary_number' | 'part_type_code'>
  > = [];
  /** Which pick lists failed to load; a failed load must not read as "nothing configured". */
  choiceErrors = { builds: false, machines: false, parts: false };
  availableMachineNumbers: string[] = [];
  availableParts: PartMasterRow[] = [];
  build: GreenshedBuild | null = null;
  part: PartMasterRow | null = null;
  machine: GreenshedMachine | null = null;
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
  error = '';
  message = '';
  result: GreenshedSetupResult | null = null;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.buildRequest++;
      this.selectedMachineNumber =
        params.get('origin') === 'running-machines' ? (params.get('machine')?.trim() ?? '') : '';
      this.startAnother();
      this.machineNumber = this.selectedMachineNumber || params.get('machine')?.trim() || '';
      this.loadSetupChoices();
    });
  }

  get machineLocked(): boolean {
    return !!this.selectedMachineNumber;
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
  /** A scan made while a lookup was running could not be used. */
  scanIgnored(scan: string): void {
    if (!this.error) this.notice = heldScanIgnoredText(scan);
  }

  get buildReady(): boolean {
    return Boolean(this.build && ['READY', 'SHELF'].includes(this.build.status_code));
  }

  /** What to do next, shown in the status line when there is no message. */
  get prompt(): string {
    if (this.busy) return 'Working…';
    if (!this.build) return 'Scan or choose the cutter build to put on a machine.';
    if (!this.buildReady) return `Build ${this.build.build_number} cannot be set up. Change the build.`;
    if (!this.machine) {
      return this.machineLocked
        ? `Machine ${this.selectedMachineNumber} was chosen on Running Machines.`
        : 'Scan or choose the machine this cutter goes on.';
    }
    if (!this.part) return 'Scan or choose the part the machine will run.';
    return 'Check the starting piece count, then tap Setup Cutter.';
  }

  /** Why Setup Cutter is not available, in operator terms. Empty when it is (or while working). */
  get setupBlockedReason(): string {
    if (this.busy) return '';
    if (!this.build) return 'Scan or choose the cutter build first (step 1).';
    if (!this.buildReady) return `Build ${this.build.build_number} is ${this.build.status_code}; only READY or SHELF cutters can be set up.`;
    if (!this.machine) return 'Scan or choose a validated machine (step 2).';
    if (!this.part) return 'Scan or choose a matching production part (step 3).';
    return '';
  }

  get buildOptions(): PickerOption[] {
    return this.availableBuilds.map((row) => ({
      value: row.build_number,
      cells: [row.build_number, `Summary ${row.summary_number}`, row.part_type_code],
    }));
  }
  get machineOptions(): PickerOption[] {
    return this.availableMachineNumbers.map((number) => ({ value: number, cells: [number] }));
  }
  get partOptions(): PickerOption[] {
    return this.matchingParts.map((row) => ({ value: row.part_number, cells: [row.part_number, row.part_type?.name ?? ''] }));
  }

  /** A build scanned or picked: the same lookup and checks as before. */
  useBuild(value: string): void {
    if (this.busy || !value.trim()) return;
    this.notice = '';
    this.buildNumber = value.trim();
    this.scanBuild();
  }
  useMachine(value: string): void {
    if (this.busy || this.machineLocked || !value.trim()) return;
    this.notice = '';
    this.machineNumber = value.trim();
    this.scanMachine();
  }
  usePart(value: string): void {
    if (this.busy || !value.trim()) return;
    this.notice = '';
    this.partNumber = value.trim();
    this.scanPart();
  }
  /** Change on a completed step clears it and everything after it, as choosing the empty option did. */
  changeBuild(): void {
    if (this.busy) return;
    this.buildNumber = '';
    this.selectBuild();
  }
  changeMachine(): void {
    if (this.busy || this.machineLocked) return;
    this.machineNumber = '';
    this.selectMachine();
  }
  changePart(): void {
    if (this.busy) return;
    this.partNumber = '';
    this.selectPart();
  }

  /** The count a shelf cutter resumes from, or null for a cutter new to a machine. */
  get carriedPieceCount(): number | null {
    const count = this.build?.status_code === 'SHELF' ? this.build.changeover_piece_count : null;
    return typeof count === 'number' ? count : null;
  }

  get choicesFailed(): boolean {
    return this.choiceErrors.builds || this.choiceErrors.machines || this.choiceErrors.parts;
  }

  reloadChoices(): void {
    if (!this.busy) this.loadSetupChoices();
  }

  private loadSetupChoices(): void {
    const request = ++this.choicesRequest;
    this.choiceErrors = { builds: false, machines: false, parts: false };
    // The dashboard lists every READY/SHELF build. The general build search returns only the
    // newest 100 open builds of any status, which pushed older shelf stock out of this picker.
    this.api
      .getDashboard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dashboard) => {
          if (request !== this.choicesRequest) return;
          this.availableBuilds = [...dashboard.available_cutters].sort((a, b) =>
            a.build_number.localeCompare(b.build_number),
          );
        },
        error: () => {
          if (request === this.choicesRequest) {
            this.availableBuilds = [];
            this.choiceErrors.builds = true;
          }
        },
      });
    this.api
      .getRunningMachines('ALL')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (board) => {
          if (request !== this.choicesRequest) return;
          const requiredDepartment =
            this.build?.part_type_code === 'RING'
              ? '152'
              : this.build?.part_type_code === 'PINION'
                ? '132'
                : '';
          this.availableMachineNumbers = board.departments
            .filter(
              (department) =>
                !requiredDepartment || department.department_code === requiredDepartment,
            )
            .flatMap((department) => department.machines)
            .filter((machine) => machine.machine_active && !machine.has_cutter)
            .map((machine) => machine.machine_number)
            .filter((value, index, all) => all.indexOf(value) === index)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        },
        error: () => {
          if (request === this.choicesRequest) {
            this.availableMachineNumbers = [];
            this.choiceErrors.machines = true;
          }
        },
      });
    this.api
      .listParts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (parts) => {
          if (request !== this.choicesRequest) return;
          this.availableParts = parts
            .filter((row) => row.active && row.enabled)
            .sort((a, b) =>
              a.part_number.localeCompare(b.part_number, undefined, { numeric: true }),
            );
        },
        error: () => {
          if (request === this.choicesRequest) {
            this.availableParts = [];
            this.choiceErrors.parts = true;
          }
        },
      });
  }

  get matchingParts(): PartMasterRow[] {
    if (!this.build) return [];
    return this.availableParts.filter(
      (row) =>
        row.summary?.number === this.build?.summary_number &&
        row.part_type?.code === this.build?.part_type_code,
    );
  }

  get selectedRollMaster(): PartMasterRow['roll_master'] {
    return this.part?.roll_master ?? null;
  }
  get rollMasterMinimumQuantity(): number {
    const row = this.selectedRollMaster;
    return row?.minimum_quantity ?? row?.required_count ?? 0;
  }
  get rollMasterCurrentQuantity(): number {
    return this.selectedRollMaster?.current_quantity ?? 0;
  }
  get rollMasterLow(): boolean {
    const row = this.selectedRollMaster;
    const minimum = this.rollMasterMinimumQuantity;
    return (
      !!row?.active && !!row?.enabled && minimum > 0 && this.rollMasterCurrentQuantity <= minimum
    );
  }

  selectBuild(): void {
    if (this.busy) return;
    if (!this.buildNumber) {
      this.buildRequest++;
      this.choicesRequest++;
      this.build = null;
      this.resetBusy();
      this.error = '';
      this.resetSetupDownstream();
      this.availableMachineNumbers = [];
      return;
    }
    this.scanBuild();
  }

  selectMachine(): void {
    if (this.busy) return;
    if (!this.machineNumber) {
      this.machineRequest++;
      this.machine = null;
      return;
    }
    this.scanMachine();
  }

  selectPart(): void {
    if (this.busy) return;
    if (!this.partNumber) {
      this.partRequest++;
      this.part = null;
      return;
    }
    this.scanPart();
  }

  scanBuild() {
    if (this.busy) return;
    const requested = this.buildNumber.trim();
    if (!requested) return;
    const request = ++this.buildRequest;
    this.build = null;
    this.resetSetupDownstream();
    const owner = this.beginBusy();
    this.error = '';
    this.message = '';
    this.api
      .getBuild(requested)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (b) => {
          this.endBusy(owner);
          if (request !== this.buildRequest) return;
          this.build = b;
          this.buildNumber = b.build_number;
          this.loadSetupChoices();
          // An intact cutter returning from a Greenshed shelf continues the count of its last run; the API enforces it.
          this.startingPieceCount = this.carriedPieceCount ?? 0;
          if (!['READY', 'SHELF'].includes(b.status_code)) {
            this.error = `Build ${b.build_number} is ${b.status_code} and cannot be setup.`;
            return;
          }
          if (this.machineLocked) this.scanMachine();
        },
        error: (e: HttpErrorResponse) => {
          this.endBusy(owner);
          if (request !== this.buildRequest) return;
          this.error = greenshedApiErrorText(e, 'Build not found.');
        },
      });
  }

  scanMachine() {
    if (this.busy) return;
    if (!this.build || !this.machineNumber.trim()) return;
    const request = ++this.machineRequest;
    const build = this.build;
    const requested = this.selectedMachineNumber || this.machineNumber.trim();
    const owner = this.beginBusy();
    this.error = '';
    this.machine = null;
    this.api
      .getMachine(requested)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => {
          this.endBusy(owner);
          if (request !== this.machineRequest || build !== this.build) return;
          this.machineNumber = this.selectedMachineNumber || m.machine_number;
          if (!m.machine_active) {
            this.error = `Machine ${m.machine_number} is inactive.`;
            return;
          }
          if (m.active_run) {
            this.error = `Machine ${m.machine_number} already has cutter ${m.active_run.build_number} running.`;
            return;
          }
          const requiredDepartment =
            build.part_type_code === 'RING'
              ? '152'
              : build.part_type_code === 'PINION'
                ? '132'
                : '';
          if (!requiredDepartment || m.department_code !== requiredDepartment) {
            this.error = `${build.part_type_code} Cutter Build ${build.build_number} cannot run on machine ${m.machine_number}. Select a compatible cutter build.`;
            return;
          }
          this.machine = m;
        },
        error: (e: HttpErrorResponse) => {
          this.endBusy(owner);
          if (request !== this.machineRequest) return;
          this.error = greenshedApiErrorText(e, 'Machine not found.');
        },
      });
  }

  scanPart() {
    if (this.busy) return;
    if (!this.build || !this.partNumber.trim()) return;
    const request = ++this.partRequest;
    const build = this.build;
    const owner = this.beginBusy();
    this.error = '';
    this.part = null;
    this.api
      .getPartByNumber(this.partNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => {
          this.endBusy(owner);
          if (request !== this.partRequest || build !== this.build) return;
          this.partNumber = p.part_number;
          if (!p.active) {
            this.error = `Part ${p.part_number} is inactive.`;
            return;
          }
          if (
            p.summary?.number !== this.build?.summary_number ||
            p.part_type?.code !== this.build?.part_type_code
          ) {
            this.error = `Part ${p.part_number} does not match Cutter Build ${this.build?.build_number}.`;
            return;
          }
          this.part = p;
        },
        error: (e: HttpErrorResponse) => {
          this.endBusy(owner);
          if (request !== this.partRequest) return;
          this.error = greenshedApiErrorText(e, 'Part not found.');
        },
      });
  }

  setup() {
    if (
      this.busy ||
      !this.build ||
      !this.machine ||
      !this.part ||
      !['READY', 'SHELF'].includes(this.build.status_code)
    )
      return;
    if (
      !Number.isSafeInteger(this.startingPieceCount) ||
      this.startingPieceCount < 0 ||
      this.startingPieceCount > 2147483647
    ) {
      this.error = 'Enter a whole starting piece count between 0 and 2,147,483,647.';
      return;
    }
    const request = this.buildRequest;
    const owner = this.beginBusy();
    this.error = '';
    this.message = '';
    this.api
      .setupCutter({
        buildNumber: this.build.build_number,
        machineNumber: this.machine.machine_number,
        partNumber: this.part.part_number,
        shift: '',
        startingPieceCount: this.startingPieceCount,
        comments: this.comments,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.endBusy(owner);
          if (request !== this.buildRequest) return;
          this.result = r;
          const message = `${r.build_number} setup on ${r.machine_number}.`;
          this.message = message;
          this.toast.success(message, 'Cutter setup complete');
        },
        error: (e: HttpErrorResponse) => {
          this.endBusy(owner);
          if (request !== this.buildRequest) return;
          const message = greenshedApiErrorText(e, 'Could not setup cutter.');
          this.error = message;
          this.toast.error(message, 'Cutter setup failed');
        },
      });
  }

  startAnother() {
    this.buildRequest++;
    this.choicesRequest++;
    this.resetBusy();
    this.buildNumber = '';
    this.build = null;
    this.resetSetupDownstream();
    this.startingPieceCount = 0;
    this.comments = '';
    this.result = null;
    this.error = '';
    this.message = '';
    this.notice = '';
  }

  /** After a completed setup the machine now has a cutter: release a machine locked from the board and reload every list. */
  setupAnother() {
    this.selectedMachineNumber = '';
    this.startAnother();
    this.loadSetupChoices();
  }

  private resetSetupDownstream() {
    this.machineRequest++;
    this.partRequest++;
    this.machineNumber = this.selectedMachineNumber;
    this.machine = null;
    this.part = null;
    this.partNumber = '';
    this.result = null;
  }
}
