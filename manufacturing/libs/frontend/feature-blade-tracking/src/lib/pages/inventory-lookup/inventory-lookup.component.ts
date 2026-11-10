import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GearToastService, announceAssetTagPrint } from '@gearapps/manufacturing/frontend/util-common';
import {
  AssetTagKind,
  BladeTrackingApiService,
  InventoryContainerRow,
  InventoryLocationRow,
  InventoryLookupResult,
  InventoryTrayRow,
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
  selector: 'gear-inventory-lookup',
  standalone: true,
  imports: [CommonModule, ScanPanelComponent, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './inventory-lookup.component.html',
})
export class InventoryLookupComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  private lookupVersion = 0;
  ngOnDestroy(): void { ++this.lookupVersion; this.destroyed$.next(); this.destroyed$.complete(); }
  private readonly api = inject(BladeTrackingApiService);
  private readonly toast = inject(GearToastService);
  private readonly route = inject(ActivatedRoute);

  @ViewChild('scanner') scanner?: ScanPanelComponent;

  result: InventoryLookupResult | null = null;
  busy = false;
  message: ScanMessage | null = null;
  printingTagSerial: string | null = null;

  ngOnInit(): void {
    // The top-bar search navigates here with a new ?serial= even when this page is already open.
    this.route.queryParamMap.pipe(takeUntil(this.destroyed$)).subscribe((params) => {
      const serial = params.get('serial')?.trim();
      if (serial) this.lookup(serial);
    });
  }

  get tray(): InventoryTrayRow | null {
    return this.result?.kind === 'tray'
      ? (this.result.value as InventoryTrayRow)
      : null;
  }

  get container(): InventoryContainerRow | null {
    return this.result?.kind === 'container'
      ? (this.result.value as InventoryContainerRow)
      : null;
  }

  get location(): InventoryLocationRow | null {
    return this.result?.kind === 'location'
      ? (this.result.value as InventoryLocationRow)
      : null;
  }

  printTag(kind: AssetTagKind, recordId: string, serialNumber: string): void {
    if (this.printingTagSerial) return;
    this.printingTagSerial = serialNumber;
    this.message = null;

    this.api.printAssetTag(kind, recordId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (result) => {
        this.printingTagSerial = null;
        if (!result.printed) {
          this.api.downloadAssetTagPrn(result);
        }
        const notice = announceAssetTagPrint(this.toast, result);
        this.message = { tone: result.printed ? 'success' : 'info', text: notice.text };
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagSerial = null;
        this.message = {
          tone: 'error',
          text: apiErrorText(error, `Could not print ${serialNumber} tag.`),
        };
        this.toast.error(this.message.text, 'Tag not printed');
      },
    });
  }

  lookup(serial: string): void {
    if (this.printingTagSerial) return;
    const version = ++this.lookupVersion;
    this.busy = true;
    this.result = null;
    this.message = null;

    this.api.lookup(serial).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (result) => {
        if (version !== this.lookupVersion) return;
        this.result = result;
        this.busy = false;
        this.scanner?.clearAndFocus();
      },
      error: (err: HttpErrorResponse) => {
        if (version !== this.lookupVersion) return;
        this.busy = false;
        this.message = {
          tone: 'error',
          // The lookup tries tray, then container, then location; the last 404 only names a location.
          text: err.status === 404
            ? `No tray, container, or location has serial ${serial.trim().toUpperCase()}.`
            : apiErrorText(err, `Could not look up ${serial}.`),
        };
        this.scanner?.select();
      },
    });
  }
}
