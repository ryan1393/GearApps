import { GearLabelPrinterPickerComponent, GearScannerFocusDirective, GearToastService } from '@gearapps/manufacturing/frontend/util-common';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  CutterBuildCard,
  CutterBuildSearchRow,
  CutterBuilderApiService,
  cutterApiErrorText,
  downloadCutterCardArtifacts,
} from '@gearapps/manufacturing/frontend/data-access-cutter-builder';
import {
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-cutter-lookup',
  standalone: true,
  imports: [CommonModule, GearScannerFocusDirective, GearLabelPrinterPickerComponent, FormsModule, DanaPageHeaderComponent, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],
  templateUrl: './cutter-lookup.component.html',
})
export class CutterLookupComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private requestVersion = 0;
  private exporting = false;
  ngOnDestroy(): void { ++this.requestVersion; this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(CutterBuilderApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(GearToastService);

  searchText = '';
  status = '';
  partType = '';
  cutterBody = '';
  results: CutterBuildSearchRow[] = [];
  card: CutterBuildCard | null = null;
  busy = false;
  error = '';
  message = '';

  readonly statuses = ['', 'READY', 'RUNNING', 'SHELF', 'PULLED', 'CLOSED'];
  readonly partTypes = ['', 'RING', 'PINION'];

  ngOnInit(): void {
    // The top-bar search navigates here with ?build=<text> even when this page is already open,
    // so follow the query string instead of reading it once.
    this.route.queryParamMap.pipe(takeUntil(this.destroyed$)).subscribe((queryParamMap) => {
      const text = queryParamMap.get('build')?.trim();
      if (text) {
        this.searchText = text;
        this.openCard(text, true);
      } else {
        this.search();
      }
    });
  }

  search(): void {
    if (this.exporting) return;
    const version = ++this.requestVersion;
    this.busy = true;
    this.error = '';
    this.message = '';
    this.card = null;

    this.api.searchBuilds({
      q: this.searchText,
      status: this.status,
      partType: this.partType,
      cutterBody: this.cutterBody,
      limit: 100,
    }).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (rows) => {
        if (version !== this.requestVersion) return;
        this.results = rows;
        this.busy = false;
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.requestVersion) return;
        this.busy = false;
        this.error = cutterApiErrorText(err, 'Could not search cutter builds.');
      },
    });
  }

  /** `searchIfMissing`: the text came from the search box and may be a body serial or Summary rather than a build number. */
  openCard(buildNumber: string, searchIfMissing = false): void {
    if (this.exporting) return;
    const version = ++this.requestVersion;
    this.card = null;
    this.busy = true;
    this.error = '';
    this.message = '';
    this.api.getCard(buildNumber).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (card) => {
        if (version !== this.requestVersion) return;
        this.card = card;
        this.searchText = card.build_number;
        this.busy = false;
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.requestVersion) return;
        if (searchIfMissing && err.status === 404) { this.search(); return; }
        this.busy = false;
        this.error = cutterApiErrorText(err, 'Cutter build not found.');
      },
    });
  }

  clear(): void {
    if (this.exporting) return;
    this.searchText = '';
    this.status = '';
    this.partType = '';
    this.cutterBody = '';
    this.card = null;
    this.search();
  }

  /** Sends the card to the card printer. If no printer takes it, the card files are saved instead. */
  print(): void {
    const buildNumber = this.card?.build_number;
    if (!buildNumber || this.busy) return;
    const version = ++this.requestVersion;
    this.exporting = true;
    this.error = '';
    this.message = '';
    this.busy = true;
    this.api.printCard(buildNumber).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (result) => {
        if (version !== this.requestVersion) return;
        this.card = result.card;
        if (result.printed) {
          this.exporting = false; this.busy = false;
          this.message = `Cutter card ${result.build_number} sent to ${result.printer_name}.`;
          this.toast.success(this.message, 'Card sent to printer');
          return;
        }
        this.saveFiles(result.card, version, result, (files) => {
          if (result.printer_configured) {
            this.error = `${result.printer_name} did not print the card. ${result.failure_reason ?? ''} ${files} were saved as a backup.`;
            this.toast.warning(this.error, 'Card not printed');
          } else {
            this.message = `No cutter card printer is set up, so ${files} were saved. An administrator can add a printer in Admin › Label Printers.`;
          }
        });
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.requestVersion) return;
        this.busy = false;
        this.exporting = false;
        this.error = cutterApiErrorText(err, 'Could not print the Cutter Card.');
        this.toast.error(this.error, 'Card not printed');
      },
    });
  }

  /** Saves the printer file and PNG preview without sending anything to a printer. */
  saveCardFiles(): void {
    const buildNumber = this.card?.build_number;
    if (!buildNumber || this.busy) return;
    const version = ++this.requestVersion;
    this.exporting = true;
    this.error = '';
    this.message = '';
    this.busy = true;
    this.api.getCard(buildNumber).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (card) => {
        if (version !== this.requestVersion) return;
        this.card = card;
        this.saveFiles(card, version, undefined, (files) => { this.message = `Saved ${files}.`; });
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.requestVersion) return;
        this.busy = false;
        this.exporting = false;
        this.error = cutterApiErrorText(err, 'Could not load the Cutter Card for export.');
      },
    });
  }

  private saveFiles(
    card: CutterBuildCard,
    version: number,
    printerFile: { file_name: string; file_base64: string } | undefined,
    report: (files: string) => void,
  ): void {
    void downloadCutterCardArtifacts(card, printerFile)
      .then(({ prnFileName, pngFileName }) => {
        if (version !== this.requestVersion) return;
        report(`${prnFileName} and ${pngFileName}`);
      })
      .catch((error: unknown) => {
        if (version !== this.requestVersion) return;
        this.error = error instanceof Error ? error.message : 'Could not export the Cutter Card files.';
      })
      .finally(() => {
        if (version !== this.requestVersion) return;
        this.exporting = false; this.busy = false;
      });
  }

  browserPrint(): void {
    window.print();
  }
}
