import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, ViewChild, inject, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  AssetTagKind,
  BladeHistoryView,
  BladeTrackingApiService,
  TrayDetails,
  apiErrorText,
} from '@gearapps/manufacturing/frontend/data-access-blade-tracking';
import { ScanMessage } from '../../models/scan-message';
import { ScanPanelComponent } from '../../shared/scan-panel/scan-panel.component';
import {
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableShellDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-tray-contents',
  standalone: true,
  imports: [CommonModule, ScanPanelComponent, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './tray-contents.component.html',
})
export class TrayContentsComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  ngOnDestroy(): void { this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(BladeTrackingApiService);
  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    // Card drilldown supplies only a serial; the normal authenticated scan/detail
    // endpoints still resolve the tray. Opening a link never moves inventory.
    this.route.queryParamMap.pipe(takeUntil(this.destroyed$)).subscribe((params) => {
      const serial = params.get('serial');
      if (serial?.trim()) this.scan(serial);
    });
  }

  @ViewChild('scanner') scanner?: ScanPanelComponent;
  details: TrayDetails | null = null;
  busy = false;
  message: ScanMessage | null = null;
  expandedBladeId: string | null = null;
  historyLoadingBladeId: string | null = null;
  historyByBladeId: Record<string, BladeHistoryView[] | undefined> = {};
  historyErrorByBladeId: Record<string, string | undefined> = {};
  printingTagSerial: string | null = null;

  scan(serial: string) {
    if (this.busy || !serial.trim()) return;
    serial = serial.trim().toUpperCase();
    this.busy = true;
    this.details = null;
    this.expandedBladeId = null;
    this.api.scanTray(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (tray) =>
        this.api.getTrayDetails(tray).pipe(takeUntil(this.destroyed$)).subscribe({
          next: (details) => {
            this.details = details;
            this.busy = false;
            this.message = {
              tone: 'success',
              text: `${details.blades.length} active blade records loaded.`,
            };
            this.scanner?.clearAndFocus();
          },
          error: (err: HttpErrorResponse) =>
            this.fail(err, 'Could not load tray details.'),
        }),
      error: (err: HttpErrorResponse) => this.fail(err, 'Tray not found.'),
    });
  }


  printTag(kind: AssetTagKind, recordId: string, serialNumber: string): void {
    if (this.printingTagSerial) return;
    this.printingTagSerial = serialNumber;
    this.api.printAssetTag(kind, recordId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (result) => {
        this.printingTagSerial = null;
        if (!result.printed) {
          this.api.downloadAssetTagPrn(result);
        }
        this.message = {
          tone: 'success',
          text: result.printed
            ? `${result.serial_number} tag sent to the IPL printer.`
            : `${result.message} ${result.file_name} downloaded.`,
        };
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagSerial = null;
        this.message = {
          tone: 'error',
          text: apiErrorText(error, `Could not print ${serialNumber} tag.`),
        };
      },
    });
  }

  get traySummary(): string {
    return (
      this.details?.tray.summary?.number ||
      this.bladeTypes[0]?.summary ||
      'Unassigned'
    );
  }

  get trayPartType(): string {
    return (
      this.details?.tray.part_type?.code ||
      this.bladeTypes[0]?.partType ||
      'Unassigned'
    );
  }

  get bladeTypes() {
    const counts = new Map<
      string,
      { summary: string; partType: string; count: number }
    >();

    for (const x of this.details?.blades ?? []) {
      const blade = x.blade;
      const summary =
        blade?.summary?.number ||
        blade?.summary?.model?.model_number?.toString() ||
        this.details?.tray.summary?.number ||
        'No Summary';
      const partType =
        blade?.part_type?.code ||
        this.details?.tray.part_type?.code ||
        'No Part Type';
      const key = `${summary}::${partType}`;
      const current = counts.get(key);
      counts.set(key, {
        summary,
        partType,
        count: (current?.count ?? 0) + 1,
      });
    }

    return [...counts.values()];
  }


  toggleBladeHistory(bladeId: string): void {
    if (this.expandedBladeId === bladeId) {
      this.expandedBladeId = null;
      return;
    }

    this.expandedBladeId = bladeId;
    if (this.historyByBladeId[bladeId]) return;

    this.historyLoadingBladeId = bladeId;
    this.historyErrorByBladeId[bladeId] = undefined;
    this.api.getBladeHistory(bladeId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (history) => {
        this.historyByBladeId[bladeId] = history;
        if (this.historyLoadingBladeId === bladeId) this.historyLoadingBladeId = null;
      },
      error: (error: HttpErrorResponse) => {
        if (this.historyLoadingBladeId === bladeId) this.historyLoadingBladeId = null;
        this.historyErrorByBladeId[bladeId] = apiErrorText(
          error,
          'Could not load this blade history.',
        );
      },
    });
  }

  eventLabel(value: string): string {
    const labels: Record<string, string> = {
      created: 'Blade created',
      status_changed: 'Status changed',
      assigned_to_tray: 'Assigned to tray',
      removed_from_tray: 'Removed from tray',
      loaded_to_container: 'Loaded to container',
      removed_from_container: 'Removed from container',
      sent_to_coater: 'Sent to coater',
      returned_from_coater: 'Returned from coater',
      installed_in_cutter: 'Installed in cutter',
      removed_from_cutter: 'Removed from cutter',
      resharpen_started: 'Resharpen started',
      cycle_completed: 'Service cycle completed',
      scrapped: 'Scrapped / discarded',
    };
    return labels[value] ?? this.readable(value);
  }

  statusLabel(value: string | null): string {
    return value ? this.readable(value) : '—';
  }

  readable(value: string): string {
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private fail(err: HttpErrorResponse, fallback: string) {
    this.busy = false;
    this.message = { tone: 'error', text: apiErrorText(err, fallback) };
    this.scanner?.select();
  }
}
