import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  BladeHistoryView,
  BladeTrackingApiService,
  InventoryBladeRow,
  apiErrorText,
} from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { IPaginationMeta } from '@meshforge/manufacturing/shared/util-types';
import {
  DanaPageHeaderComponent,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
} from '@dana/ui';

@Component({
  selector: 'gear-scrap-blades',
  standalone: true,
  imports: [CommonModule, FormsModule, DanaPageHeaderComponent, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective],
  templateUrl: './scrap-blades.component.html',
})
export class ScrapBladesComponent implements OnInit {
  private readonly api = inject(BladeTrackingApiService);

  rows: InventoryBladeRow[] = [];
  meta: IPaginationMeta | null = null;
  loading = true;
  error = '';
  searchValue = '';
  appliedSearch = '';

  expandedBladeId: string | null = null;
  historyLoadingBladeId: string | null = null;
  historyByBladeId: Record<string, BladeHistoryView[] | undefined> = {};
  historyErrorByBladeId: Record<string, string | undefined> = {};

  ngOnInit(): void {
    this.loadPage(1);
  }

  get totalScrapped(): number {
    return this.meta?.totalItems ?? 0;
  }

  search(): void {
    this.appliedSearch = this.searchValue.trim();
    this.loadPage(1);
  }

  clearSearch(): void {
    this.searchValue = '';
    this.appliedSearch = '';
    this.loadPage(1);
  }

  refresh(): void {
    this.loadPage(this.meta?.page ?? 1);
  }

  private pageVersion = 0;

  /** Only the newest page answer is shown: paging or searching again makes an earlier answer stale. */
  loadPage(page: number): void {
    if (page < 1) return;

    const version = ++this.pageVersion;
    this.loading = true;
    this.error = '';
    this.expandedBladeId = null;

    this.api.getScrappedBlades(page, 50, this.appliedSearch).subscribe({
      next: (response) => {
        if (version !== this.pageVersion) return;
        this.rows = response.data;
        this.meta = response.meta;
        this.loading = false;
      },
      error: (error: HttpErrorResponse) => {
        if (version !== this.pageVersion) return;
        this.loading = false;
        this.error = apiErrorText(
          error,
          'Could not load scrap / discarded blade records.',
        );
      },
    });
  }

  toggleHistory(blade: InventoryBladeRow): void {
    if (this.expandedBladeId === blade.id) {
      this.expandedBladeId = null;
      return;
    }

    this.expandedBladeId = blade.id;
    if (this.historyByBladeId[blade.id]) {
      return;
    }

    this.historyLoadingBladeId = blade.id;
    this.historyErrorByBladeId[blade.id] = undefined;

    this.api.getBladeHistory(blade.id).subscribe({
      next: (history) => {
        this.historyByBladeId[blade.id] = history;
        if (this.historyLoadingBladeId === blade.id) this.historyLoadingBladeId = null;
      },
      error: (error: HttpErrorResponse) => {
        if (this.historyLoadingBladeId === blade.id) this.historyLoadingBladeId = null;
        this.historyErrorByBladeId[blade.id] = apiErrorText(
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

  private readable(value: string): string {
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}
