import { Subject, takeUntil } from 'rxjs';
import { cutterBodyBladeCapacity, cutterBodyMatchesRequirement } from '@meshforge/manufacturing/shared/util-constants';
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
import { MachineDsfCountComponent, GearLabelPrinterPickerComponent, GearScannerFocusDirective, GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { DanaPageHeaderComponent } from '@dana/ui';
import { ITray } from '@meshforge/manufacturing/shared/util-types';

@Component({
  selector: 'gear-cutter-build',
  standalone: true,
  imports: [MachineDsfCountComponent, CommonModule, GearScannerFocusDirective, GearLabelPrinterPickerComponent, FormsModule, DanaPageHeaderComponent],
  templateUrl: './cutter-build.component.html',
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
  result: CutterBuildResult | null = null;

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

  cutterBodyRequiredBladeCount(body: CutterBody | null = this.cutterBody): number | null {
    return cutterBodyBladeCapacity(body);
  }

  get compatibleReadyTrays(): CutterDashboardData['ready_for_cutter'] {
    const body = this.cutterBody;
    if (!body) return [];
    return this.availableReadyTrays.filter(row =>
      row.required_blade_count !== null && row.blade_count === row.required_blade_count &&
      cutterBodyMatchesRequirement(body, row.required_blade_count, row.part_type_code ?? ''),
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
        this.traySerial.trim().toUpperCase() === this.tray.serial_number.toUpperCase() &&
        [this.cutterBody.dana_serial_number, this.cutterBody.mf_serial_number].some(serial => serial?.toUpperCase() === this.cutterBodySerial.trim().toUpperCase()) &&
        cutterBodyMatchesRequirement(this.cutterBody, this.trayValidation.required_blade_count, this.tray.part_type?.code ?? '') &&
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
          this.toast.success(
            `Build ${result.build.build_number} created with ${result.build.blade_count} blades.`,
            'Cutter build complete',
          );
        },
        error: (err: HttpErrorResponse) => {
          this.busy = false;
          const message = cutterApiErrorText(err, 'Could not create Cutter Build.');
          this.toast.error(message, 'Cutter build failed');
        },
      });
  }

  printing = false;

  /** Sends the new card to the card printer; with no card printer set up, opens the browser print as before. */
  print(): void {
    const buildNumber = this.result?.build.build_number;
    if (!buildNumber || this.printing) return;
    this.printing = true;
    this.api.printCard(buildNumber).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (outcome) => {
        this.printing = false;
        if (outcome.printed) this.toast.success(`Cutter card ${outcome.build_number} sent to ${outcome.printer_name}.`, 'Card sent to printer');
        else if (outcome.printer_configured) this.toast.warning(`${outcome.printer_name} did not print the card. ${outcome.failure_reason ?? ''} Select Print Cutter Card to try again, or use Browser Print.`, 'Card not printed');
        else this.browserPrint();
      },
      error: (err: HttpErrorResponse) => {
        this.printing = false;
        this.toast.error(cutterApiErrorText(err, 'Could not print the Cutter Card.'), 'Card not printed');
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
      this.api.validateTray(tray).pipe(takeUntil(this.destroyed$)).subscribe({
        next: (validation) => {
          if (version !== this.scanVersion) return;
          this.busy = false;
          this.trayValidation = validation;
          if (this.cutterBody && !cutterBodyMatchesRequirement(this.cutterBody, validation.required_blade_count, tray.part_type?.code ?? '')) {
            this.trayValidation = null;
            this.error = 'This tray does not match the selected Cutter Body capacity or blade family.';
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
  }
}
