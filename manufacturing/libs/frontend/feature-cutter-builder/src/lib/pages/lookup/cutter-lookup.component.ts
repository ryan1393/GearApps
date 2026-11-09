import { GearScannerFocusDirective } from '@gearapps/manufacturing/frontend/util-common';
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
  imports: [CommonModule, GearScannerFocusDirective, FormsModule, DanaPageHeaderComponent, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],
  templateUrl: './cutter-lookup.component.html',
})
export class CutterLookupComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private requestVersion = 0;
  private exporting = false;
  ngOnDestroy(): void { ++this.requestVersion; this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(CutterBuilderApiService);
  private readonly route = inject(ActivatedRoute);

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
    const build = this.route.snapshot.queryParamMap.get('build')?.trim();
    if (build) {
      this.searchText = build;
      this.openCard(build);
      return;
    }
    this.search();
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

  openCard(buildNumber: string): void {
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

  print(): void {
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
        void downloadCutterCardArtifacts(card)
          .then(({ prnFileName, pngFileName }) => {
            if (version !== this.requestVersion) return;
            this.message = 'Saved ' + prnFileName + ' and ' + pngFileName + '.';
          })
          .catch((error: unknown) => {
            if (version !== this.requestVersion) return;
            this.error = error instanceof Error ? error.message : 'Could not export the Cutter Card files.';
          })
          .finally(() => {
            if (version !== this.requestVersion) return;
            this.exporting = false; this.busy = false;
          });
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.requestVersion) return;
        this.busy = false;
        this.exporting = false;
        this.error = cutterApiErrorText(err, 'Could not load the Cutter Card for export.');
      },
    });
  }

  browserPrint(): void {
    window.print();
  }
}
