import { Subject, takeUntil } from 'rxjs';
import {
  CutterBodyRuleResolution,
  cutterBodyMatchesRequirement,
  evaluateCutterBodyCompatibility,
  formatBladeSetQuantity,
  resolveCutterBodyRule,
} from '@meshforge/manufacturing/shared/util-constants';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CutterBody,
  CutterBuilderMachine,
  CutterBuildResult,
  CutterBuilderApiService,
  CutterDashboardData,
  CutterTrayValidation,
  cutterApiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import {
  GearLabelPrinterPickerComponent,
  GearToastService,
  MachineDsfCountComponent,
  OptionPickerComponent,
  PickerOption,
  ScanPanelComponent,
  StationStatusComponent,
  createStatusLine,
  heldScanIgnoredText,
} from '@meshforge/manufacturing/frontend/util-common';
import { DanaPageHeaderComponent } from '@dana/ui';
import { ITray } from '@meshforge/manufacturing/shared/util-types';

@Component({
  selector: 'gear-cutter-build',
  standalone: true,
  imports: [MachineDsfCountComponent, CommonModule, GearLabelPrinterPickerComponent, FormsModule, DanaPageHeaderComponent, ScanPanelComponent, StationStatusComponent, OptionPickerComponent],
  templateUrl: './cutter-build.component.html',
  styleUrl: '../station-page.css',
})
export class CutterBuildComponent implements OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private scanVersion = 0;
  ngOnDestroy(): void { ++this.scanVersion; this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(CutterBuilderApiService);
  private readonly toast = inject(GearToastService);

  cutterBodySerial = '';
  cutterBody: CutterBody | null = null;

  traySerial = '';
  tray: ITray | null = null;
  trayValidation: CutterTrayValidation | null = null;
  availableCutterBodies: CutterBody[] = [];
  availableReadyTrays: CutterDashboardData['ready_for_cutter'] = [];
  selectedCutterBodyId = '';
  selectedTraySerial = '';
  availableCutterBuilderMachines: CutterBuilderMachine[] = [];
  selectedCutterBuilderMachineId = '';

  honed = false;
  coated = false;
  ibRo: number | null = null;
  obRo: number | null = null;
  comments = '';

  busy = false;
  error = '';
  /** The last success, for the status line (the toast still shows it too). */
  message = '';
  /** Shown when there is no error or success: e.g. a scan made too early. */
  notice = '';
  result: CutterBuildResult | null = null;

  // ---- Station layout: numbered scan-or-pick steps, one status line, a reason on a blocked action ----

  private readonly statusLine = createStatusLine();
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

  /** Bodies offered in the list: those whose blade capacity is known (the others could not be chosen before either). */
  get bodyOptions(): PickerOption[] {
    return this.availableCutterBodies
      .filter((body) => this.cutterBodyRule(body).rule)
      .map((body) => ({
        value: body.dana_serial_number ?? body.mf_serial_number ?? '',
        cells: [body.dana_serial_number || body.mf_serial_number || '', body.definition?.definition_code ?? '—', this.cutterBodyCapacityText(body)],
      }))
      .filter((option) => option.value);
  }
  get trayOptions(): PickerOption[] {
    return this.compatibleReadyTrays.map((ready) => ({
      value: ready.tray_serial_number,
      cells: [ready.tray_serial_number, ready.summary_number || 'No Summary', ready.part_type_code || 'No Part Type', this.bladeSetText(ready.blade_count)],
    }));
  }

  /** What to do next, shown in the status line when there is no message. */
  get prompt(): string {
    if (this.busy) return 'Working…';
    if (this.result) return 'Build created. Print the card again if needed, or tap Build Another.';
    if (!this.cutterBody) return 'Scan the Cutter Body (Dana S/N, or MF S/N), or choose it from the list.';
    if (!this.tray) return 'Scan or choose a ready blade tray for this body.';
    if (!this.selectedCutterBuilderMachineId) return 'Choose the Cutter Builder machine, then tap Create Cutter Build.';
    return 'Check the details, then tap Create Cutter Build. The card prints by itself.';
  }

  /** Why Create Cutter Build is not available, in operator terms. Empty when it is (or while working). */
  get buildBlockedReason(): string {
    if (this.busy || this.result || this.canBuild) return '';
    const body = this.cutterBody;
    if (!body) return 'Scan or choose the Cutter Body first (step 1).';
    if (!body.enabled) return 'This Cutter Body is disabled and cannot be used for a build.';
    const validation = this.trayValidation;
    if (!this.tray) return 'Scan or choose a ready blade tray (step 2).';
    if (!validation) return 'The tray did not pass validation for this body. Scan another tray.';
    if (!validation.valid) return validation.reason || 'This tray is not ready for Cutter Builder.';
    if (validation.body_available === false) return validation.body_availability_reason || 'This Cutter Body is not available.';
    if (!this.selectedCutterBuilderMachineId || !this.availableCutterBuilderMachines.some((machine) => machine.id === this.selectedCutterBuilderMachineId)) {
      return 'Choose the Cutter Builder machine (step 3).';
    }
    return this.bodyCompatibility?.reason || 'This body and tray do not match. Check the tray validation.';
  }

  /** A body scanned or picked: the same lookup and checks as before. */
  useBody(value: string): void {
    if (this.busy || !value.trim()) return;
    this.notice = '';
    this.cutterBodySerial = value.trim();
    this.scanCutterBody();
  }
  changeBody(): void {
    if (this.busy) return;
    this.cutterBodyChanged('');
  }
  useTray(value: string): void {
    if (this.busy || !value.trim()) return;
    this.notice = '';
    this.traySerial = value.trim();
    this.scanTray();
  }
  changeTray(): void {
    if (this.busy) return;
    this.trayChanged('');
  }

  get bodyDisplaySerial(): string {
    return (
      this.cutterBody?.dana_serial_number ??
      this.cutterBody?.mf_serial_number ??
      this.cutterBodySerial
    );
  }

  constructor() {
    this.refreshAvailableSelections();
  }

  /** Pick lists that have answered, and those that failed: only an answered empty list means "none available". */
  selectionState = { bodies: 'loading', trays: 'loading', machines: 'loading' } as Record<'bodies' | 'trays' | 'machines', 'loading' | 'ready' | 'failed'>;
  get selectionsFailed(): boolean { return Object.values(this.selectionState).includes('failed'); }

  refreshAvailableSelections(): void {
    this.selectionState = { bodies: 'loading', trays: 'loading', machines: 'loading' };
    this.api.listCutterBodies().pipe(takeUntil(this.destroyed$)).subscribe({
      next: (rows) => { this.availableCutterBodies = rows.filter((body) => body.enabled); this.selectionState.bodies = 'ready'; },
      error: () => { this.availableCutterBodies = []; this.selectionState.bodies = 'failed'; },
    });
    this.api.getDashboard().pipe(takeUntil(this.destroyed$)).subscribe({
      next: (data) => { this.availableReadyTrays = data.ready_for_cutter ?? []; this.selectionState.trays = 'ready'; },
      error: () => { this.availableReadyTrays = []; this.selectionState.trays = 'failed'; },
    });
    this.api.listCutterBuilderMachines().pipe(takeUntil(this.destroyed$)).subscribe({
      next: (rows) => {
        this.availableCutterBuilderMachines = rows;
        this.selectionState.machines = 'ready';
        if (this.selectedCutterBuilderMachineId && !rows.some((row) => row.id === this.selectedCutterBuilderMachineId)) {
          this.selectedCutterBuilderMachineId = '';
        }
      },
      error: () => {
        this.availableCutterBuilderMachines = [];
        this.selectedCutterBuilderMachineId = '';
        this.selectionState.machines = 'failed';
      },
    });
  }

  selectAvailableCutterBody(): void {
    const body = this.availableCutterBodies.find((row) => row.id === this.selectedCutterBodyId);
    if (!body) { this.cutterBodyChanged(''); return; }
    const serial = body.dana_serial_number ?? body.mf_serial_number ?? '';
    if (!serial) return;
    this.cutterBodySerial = serial;
    this.scanCutterBody();
  }

  selectAvailableTray(): void {
    if (!this.selectedTraySerial) { this.trayChanged(''); return; }
    this.traySerial = this.selectedTraySerial;
    this.scanTray();
  }

  /** The body's rule decoded from its Dana S/N (never the MF serial). */
  cutterBodyRule(body: CutterBody | null = this.cutterBody): CutterBodyRuleResolution {
    return resolveCutterBodyRule(body);
  }

  /** "105 Standard · 38 blades (19 sets)" or the reason it is unresolved. */
  cutterBodyCapacityText(body: CutterBody | null = this.cutterBody): string {
    const { rule, source } = resolveCutterBodyRule(body);
    const from = source === 'DEFINITION' ? ' · from body definition (not etched)' : '';
    return rule ? `${rule.label} · ${rule.total_blades} blades (${rule.blade_sets} sets)${from}` : 'Blade capacity unresolved';
  }

  bladeSetText(sets: number | null | undefined): string {
    return formatBladeSetQuantity(sets);
  }

  /** Compatibility of the selected body with the validated tray, including the Summary Body Size Rule. */
  get bodyCompatibility() {
    if (!this.cutterBody || !this.trayValidation || !this.tray) return null;
    return evaluateCutterBodyCompatibility(this.cutterBody, this.trayValidation.required_blade_count,
      this.tray.part_type?.code ?? '', this.trayValidation.summary_body_rule ?? null);
  }

  get compatibleReadyTrays(): CutterDashboardData['ready_for_cutter'] {
    const body = this.cutterBody;
    if (!body) return [];
    return this.availableReadyTrays.filter(row =>
      row.required_blade_count !== null && row.blade_count === row.required_blade_count &&
      cutterBodyMatchesRequirement(body, row.required_blade_count, row.part_type_code ?? '', row.summary_body_rule ?? null),
    );
  }

  get canBuild(): boolean {
    return Boolean(
      !this.busy && !this.result &&
        this.selectedCutterBuilderMachineId &&
        this.availableCutterBuilderMachines.some((machine) => machine.id === this.selectedCutterBuilderMachineId) &&
        this.cutterBody?.enabled &&
        this.tray &&
        this.trayValidation?.valid &&
        this.trayValidation.body_compatible !== false &&
        this.trayValidation.body_available !== false &&
        this.traySerial.trim().toUpperCase() === this.tray.serial_number.toUpperCase() &&
        [this.cutterBody.dana_serial_number, this.cutterBody.mf_serial_number].some(serial => serial?.toUpperCase() === this.cutterBodySerial.trim().toUpperCase()) &&
        cutterBodyMatchesRequirement(this.cutterBody, this.trayValidation.required_blade_count, this.tray.part_type?.code ?? '', this.trayValidation.summary_body_rule ?? null) &&
        this.trayValidation.blades_ready_for_cutter &&
        !this.trayValidation.already_assigned_to_build &&
        !this.trayValidation.still_in_container &&
        this.trayValidation.tray_stage_ready,
    );
  }

  cutterBodyChanged(value: string): void {
    this.cutterBodySerial = value; this.cutterBody = null; this.selectedCutterBodyId = '';
    this.result = null; ++this.scanVersion; this.busy = false; this.resetTrayDownstream();
  }

  trayChanged(value: string): void {
    this.traySerial = value; this.tray = null; this.trayValidation = null; this.selectedTraySerial = '';
    this.result = null; ++this.scanVersion; this.busy = false;
  }

  scanCutterBody(): void {
    const value = this.cutterBodySerial.trim();
    if (!value || this.busy) return;

    this.clearError();
    this.result = null;
    this.cutterBody = null;
    this.resetTrayDownstream();
    this.busy = true;

    const version = ++this.scanVersion;
    this.api.scanCutterBody(value).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (body) => {
        if (version !== this.scanVersion) return;
        this.busy = false;
        this.cutterBody = body;
        this.cutterBodySerial = body.dana_serial_number ?? body.mf_serial_number ?? value;
        if (!body.enabled) {
          this.error = 'This Cutter Body is disabled and cannot be used for a build.';
        }
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.scanVersion) return;
        this.busy = false;
        this.error = cutterApiErrorText(err, 'Cutter Body was not found.');
      },
    });
  }

  scanTray(): void {
    const value = this.traySerial.trim();
    if (!value || this.busy) return;

    if (!this.cutterBody) {
      this.error = 'Scan the Cutter Body before scanning the blade tray.';
      return;
    }

    this.clearError();
    this.result = null;
    this.tray = null;
    this.trayValidation = null;
    this.busy = true;

    const version = ++this.scanVersion;
    this.api.scanTray(value).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (tray) => {
        if (version !== this.scanVersion) return;
        this.tray = tray;
        this.traySerial = tray.serial_number;
        this.validateTray(tray, version);
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.scanVersion) return;
        this.busy = false;
        this.error = cutterApiErrorText(err, 'Blade tray was not found.');
      },
    });
  }

  build(): void {
    if (!this.canBuild || !this.cutterBody || !this.tray) return;

    const identifier = this.cutterBody.dana_serial_number ?? this.cutterBody.mf_serial_number;
    if (!identifier) {
      this.error = 'The selected Cutter Body has no usable Dana or MF serial number.';
      return;
    }

    this.clearError();
    this.busy = true;

    this.api
      .createBuild({
        cutterBodyIdentifier: identifier,
        traySerial: this.tray.serial_number,
        cutterBuilderMachineId: this.selectedCutterBuilderMachineId,
        honed: this.honed,
        coated: this.coated,
        ibRo: this.ibRo,
        obRo: this.obRo,
        comments: this.comments,
      })
      .pipe(takeUntil(this.destroyed$)).subscribe({
        next: (result) => {
          this.busy = false;
          this.result = result;
          // The body and tray just used are no longer available: reload the pick lists for the next build.
          this.refreshAvailableSelections();
          this.message = `Build ${result.build.build_number} created with ${result.build.blade_count} blades.`;
          this.toast.success(this.message, 'Cutter build complete');
          // The card goes to the card printer as soon as the build exists; Print Cutter Card reprints it.
          this.print();
        },
        error: (err: HttpErrorResponse) => {
          this.busy = false;
          const message = cutterApiErrorText(err, 'Could not create Cutter Build.');
          this.error = message;
          this.toast.error(message, 'Cutter build failed');
        },
      });
  }

  printing = false;

  /**
   * Sends the new card to the card printer. Runs by itself once a build is created and again from
   * Print Cutter Card. With no card printer set up, opens the browser print as before.
   */
  print(): void {
    const buildNumber = this.result?.build.build_number;
    if (!buildNumber || this.printing) return;
    this.printing = true;
    this.api.printCard(buildNumber).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (outcome) => {
        this.printing = false;
        if (outcome.printed) this.toast.success(`Cutter card ${outcome.build_number} sent to ${outcome.printer_name}.`, 'Card sent to printer');
        else if (outcome.printer_configured) this.toast.warning(`${outcome.printer_name} did not print the card. ${outcome.failure_reason ?? ''} Select Print Cutter Card to try again, or use Browser Print.`, 'Card not printed');
        // Wait for the card to be on screen before the browser prints the page.
        else if (this.result?.build.build_number === buildNumber) setTimeout(() => this.browserPrint());
      },
      error: (err: HttpErrorResponse) => {
        this.printing = false;
        this.toast.error(cutterApiErrorText(err, 'Could not print the Cutter Card.') + ' Select Print Cutter Card to try again.', 'Card not printed');
      },
    });
  }

  browserPrint(): void {
    globalThis.print();
  }

  reset(): void {
    ++this.scanVersion; this.busy = false;
    this.cutterBodySerial = '';
    this.cutterBody = null;
    this.selectedCutterBodyId = '';
    this.traySerial = '';
    this.selectedTraySerial = '';
    this.selectedCutterBuilderMachineId = '';
    this.tray = null;
    this.trayValidation = null;
    this.honed = false;
    this.coated = false;
    this.ibRo = null;
    this.obRo = null;
    this.comments = '';
    this.result = null;
    this.clearError();
  }

  private validateTray(tray: ITray, version: number): void {
    try {
      const bodySerial = this.cutterBody?.dana_serial_number || this.cutterBody?.mf_serial_number || null;
      this.api.validateTray(tray, bodySerial).pipe(takeUntil(this.destroyed$)).subscribe({
        next: (validation) => {
          if (version !== this.scanVersion) return;
          this.busy = false;
          this.trayValidation = validation;
          // The API's answer for this body wins; the shared rule is the fallback for an older API.
          const compatibility = this.cutterBody
            ? evaluateCutterBodyCompatibility(this.cutterBody, validation.required_blade_count, tray.part_type?.code ?? '', validation.summary_body_rule ?? null)
            : null;
          const bodyReason = validation.body_compatible === false
            ? validation.body_reason
            : validation.body_compatible === undefined && compatibility && !compatibility.compatible ? compatibility.reason : null;
          if (bodyReason) {
            this.trayValidation = null;
            this.error = `This tray does not match the selected Cutter Body: ${bodyReason}`;
          } else if (!validation.valid) {
            this.error = validation.reason || 'This tray is not ready for Cutter Builder.';
          }
        },
        error: (err: HttpErrorResponse) => {
          if (version !== this.scanVersion) return;
          this.busy = false;
          this.trayValidation = null;
          this.error = cutterApiErrorText(err, 'Could not validate this tray for Cutter Builder.');
        },
      });
    } catch (error) {
      this.busy = false;
      this.trayValidation = null;
      this.error = error instanceof Error ? error.message : 'Could not validate this tray.';
    }
  }

  private resetTrayDownstream(): void {
    this.traySerial = '';
    this.selectedTraySerial = '';
    this.tray = null;
    this.trayValidation = null;
  }

  private clearError(): void {
    this.error = '';
    this.message = '';
    this.notice = '';
  }
}
