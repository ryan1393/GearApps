import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Directive, ElementRef, inject, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Loadable, loadable } from '@meshforge/client/core';
import { announceAssetTagPrint, GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { Observable } from 'rxjs';

import { AdminApiService, adminApiErrorText, AssetTagKind } from '../admin-api.service';
import { AdminConfirmation, adminSearchMatches, failedLists } from './admin-data';
import { AdminTab } from './admin-tabs';

/**
 * What every Admin record tab shares: its lists (cancelled when the tab closes), one save at a
 * time with a single success or failure notice beside the form, in-page confirmations, search,
 * moving to the form on Edit, and tag printing.
 */
@Directive()
export abstract class AdminTabBase implements OnDestroy {
  protected readonly api = inject(AdminApiService);
  protected readonly cdr = inject(ChangeDetectorRef);
  protected readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly toast = inject(GearToastService);
  // Optional so a tab also renders outside a router (component tests).
  private readonly router = inject(Router, { optional: true });
  private readonly route = inject(ActivatedRoute, { optional: true });

  busy = false;
  message = '';
  error = '';
  printingTagId: string | null = null;
  readonly confirmation = new AdminConfirmation();

  private readonly ownLists: Loadable<unknown>[] = [];
  /** Lists the form chooses from, by name; a failure is reported once above the form. */
  protected choiceLists: Record<string, Loadable<unknown>> = {};

  /** A list that is cancelled when the tab closes. */
  protected list<T>(initial: T): Loadable<T> {
    const created = loadable(initial);
    this.ownLists.push(created as Loadable<unknown>);
    return created;
  }

  ngOnDestroy(): void {
    for (const list of this.ownLists) list.dispose();
  }

  get failedChoices(): string[] { return failedLists(this.choiceLists); }

  /** Reloads the choice lists that failed. */
  abstract retryChoices(): void;

  /** Another Admin tab, e.g. Gearsets from a gearset part. */
  openTab(tab: AdminTab): void {
    if (this.router && this.route) void this.router.navigate(['..', tab], { relativeTo: this.route });
  }

  protected matches(searchText: string, values: unknown[]): boolean {
    return adminSearchMatches(searchText, values);
  }

  /** Sends one change; success shows in the "Saved." banner, a failure once in the error banner. */
  protected runSave(request: Observable<unknown>, successMessage: string, onSuccess: () => void): void {
    if (this.busy) return;
    this.busy = true;
    this.clearNotice();
    request.subscribe({
      next: () => {
        this.busy = false;
        this.message = successMessage;
        onSuccess();
        this.cdr.markForCheck();
      },
      // The typed draft is kept so the administrator can correct it and save again.
      error: (error: HttpErrorResponse) => {
        this.busy = false;
        this.error = adminApiErrorText(error);
        this.cdr.markForCheck();
      },
    });
  }

  /** Disabling waits for an in-page confirmation; `send` runs once it is given. */
  protected askDisable(what: string, consequence: string, send: () => void): void {
    if (this.busy) return;
    this.confirmation.ask({ title: `Disable ${what}?`, message: `Disable ${what}? ${consequence}`, confirmLabel: 'Disable', danger: true, run: send });
    this.cdr.markForCheck();
  }

  /** Brings the tab's form into view and focuses its first field, e.g. after Edit is clicked below it. */
  protected focusEditor(): void {
    this.cdr.detectChanges();
    const form = this.element.nativeElement.querySelector<HTMLElement>('form[data-admin-editor]');
    if (!form) return;
    form.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    form.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')?.focus({ preventScroll: true });
  }

  protected focusField(selector: string): void {
    this.cdr.detectChanges();
    this.element.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }

  printTag(kind: AssetTagKind, recordId: string, serialNumber: string): void {
    if (this.printingTagId) return;
    this.clearNotice();
    // A location's summary tag is printed from the same row as its location tag.
    this.printingTagId = kind === 'LOCATION_SUMMARY' ? `${recordId}:summary` : recordId;
    this.api.printAssetTag(kind, recordId).subscribe({
      next: (result) => {
        this.printingTagId = null;
        if (!result.printed) this.api.downloadAssetTagPrn(result);
        // The page banners read "Saved." and "Unable to continue.", which fit neither a sent tag nor
        // a downloaded one, so the outcome is announced on its own.
        announceAssetTagPrint(this.toast, result);
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.printingTagId = null;
        // Shown once, in the banner beside the form.
        this.error = adminApiErrorText(error) || `Could not print ${serialNumber} tag.`;
        this.cdr.markForCheck();
      },
    });
  }

  protected clearNotice(): void {
    this.message = '';
    this.error = '';
  }
}
