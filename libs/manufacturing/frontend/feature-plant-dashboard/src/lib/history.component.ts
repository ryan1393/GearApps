import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DanaAlertDirective, DanaButtonDirective, DanaEmptyStateDirective, DanaKpiCardDirective, DanaKpiGridDirective, DanaLoadingStateDirective, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective, DanaThemeToggleComponent } from '@dana/ui';
import { PlantHistoryDataService } from '@meshforge/manufacturing/frontend/data-access-plant-dashboard';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { defaultHistoryFilters, historyCountLabel, historyCsv, historyFilterError, plantDate, type PlantHistoryFilters } from '@meshforge/manufacturing/frontend/util-plant-dashboard';
import type { DsfHistoryRecord, DsfHistorySource } from '@meshforge/shared/domain';

@Component({
  selector: 'gear-plant-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, DanaAlertDirective, DanaButtonDirective, DanaEmptyStateDirective, DanaKpiCardDirective, DanaKpiGridDirective, DanaLoadingStateDirective, DanaPageHeaderComponent, DanaTableDirective, DanaTableShellDirective, DanaThemeToggleComponent],
  providers: [PlantHistoryDataService],
  templateUrl: './history.component.html',
  styleUrls: ['./plant-layout.css', './history-layout.css'],
})
export class HistoryComponent {
  private readonly timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Indiana/Indianapolis', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  private readonly data = inject(PlantHistoryDataService);
  private readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  readonly status = this.data.status;
  readonly report = this.data.report;
  readonly error = this.data.error;
  readonly statusError = this.data.statusError;
  readonly sourcesError = this.data.sourcesError;
  readonly loading = this.data.loading;
  readonly draft = signal<PlantHistoryFilters>(defaultHistoryFilters());
  readonly filterError = computed(() => historyFilterError(this.draft()));
  readonly today = plantDate();
  readonly countLabel = historyCountLabel;
  readonly departments = computed(() => {
    const names = new Map<string, string>();
    for (const source of this.data.sources()?.sources ?? []) {
      if (source.department_id) names.set(source.department_id, source.department_name || 'Unnamed department');
    }
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  });
  readonly sources = computed(() => (this.data.sources()?.sources ?? []).filter(source =>
    (this.draft().include_inactive || source.active && source.current) &&
    (!this.draft().department_id || source.department_id === this.draft().department_id))
    .sort((a, b) => a.source_name.localeCompare(b.source_name, undefined, { numeric: true })));
  readonly reviewRecords = computed(() => {
    const totals = this.report()?.totals;
    return totals ? totals.partial_records + totals.unknown_records + totals.review_records : null;
  });
  readonly knownSubtotal = computed(() => {
    const report = this.report();
    return report?.available && report.rows.some(row => !row.duplicate_operation &&
      row.completeness !== 'REVIEW' && row.covered_seconds > 0) ? report.totals.known_subtotal : null;
  });

  constructor() { this.data.applyFilters(this.draft()); }

  updateFilters(change: Partial<PlantHistoryFilters>): void {
    this.draft.update(current => ({ ...current, ...change,
      ...(change.department_id !== undefined || change.include_inactive === false ? { source_key: '' } : {}),
    }));
  }

  applyFilters(): void { if (!this.filterError()) this.data.applyFilters(this.draft()); }
  refresh(): void { this.data.refresh(); }
  logout(): void { this.session.logout(); void this.router.navigateByUrl('/login'); }

  formatTime(value: string | null): string {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    return this.timeFormatter.format(new Date(value));
  }

  sourceLabel(source: DsfHistorySource): string {
    return source.source_name + (source.machine_number ? ` · Machine ${source.machine_number}` : '') +
      (!source.current ? ' · Earlier source identity' : !source.active ? ' · Inactive' : '');
  }

  recordKey(row: DsfHistoryRecord): string { return [row.source_key, row.period_start, row.period_end, row.shift_id ?? 'unassigned'].join('|'); }
  displayCount(row: DsfHistoryRecord): number | null { return row.completeness === 'UNKNOWN' ? null : row.count; }

  exportReport(): void {
    const report = this.report();
    if (!report) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', historyCsv(report, this.data.filters() ?? undefined)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `plant-count-history-${report.from}-${report.to}-${report.group}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
