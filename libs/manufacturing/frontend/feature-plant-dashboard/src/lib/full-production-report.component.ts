import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { DanaButtonDirective, DanaTableDirective, DanaTableShellDirective } from '@dana/ui';
import { buildHourlyProductionChart, type HourlyProductionBucket } from '@meshforge/manufacturing/frontend/util-plant-dashboard';
import type { DsfHistoryCollectorStatus, DsfHistoryReport, DsfHistorySource } from '@meshforge/shared/domain';

@Component({
  selector: 'gear-full-production-report', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DanaButtonDirective, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './full-production-report.component.html',
  styleUrl: './full-production-report.component.css',
})
export class FullProductionReportComponent {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  readonly source = input.required<DsfHistorySource>();
  readonly report = input<DsfHistoryReport | null>(null);
  readonly collector = input<DsfHistoryCollectorStatus | null>(null);
  readonly date = input('');
  readonly model = computed(() => buildHourlyProductionChart(this.report(), this.source().source_key));
  readonly firstRecordedHour = computed(() => this.model().buckets.find(bucket => bucket.knownCount !== null)?.start ?? null);
  readonly lastObserved = computed(() => {
    const times = (this.report()?.rows ?? []).filter(row => row.source_key === this.source().source_key)
      .map(row => row.observed_at).filter((value): value is string => value !== null && Number.isFinite(Date.parse(value)));
    return times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  });

  formatTime(value: string | null): string { return value && Number.isFinite(Date.parse(value)) ? this.timeFormatter.format(Date.parse(value)) : 'Not captured'; }
  barWidth(bucket: HourlyProductionBucket): number { return bucket.knownCount === null ? 0 : bucket.knownCount / Math.max(1, this.model().maxKnownCount) * 100; }
  coverage(bucket: HourlyProductionBucket): string {
    return bucket.completeness === 'COMPLETE' ? 'Complete hour' : bucket.completeness === 'REVIEW' ? 'Needs review'
      : bucket.knownCount !== null ? 'Partial coverage' : 'Unknown';
  }
  countDescription(bucket: HourlyProductionBucket): string {
    return bucket.knownCount === null ? `Count unavailable · ${this.coverage(bucket)}`
      : `${bucket.knownCount.toLocaleString('en-US')} ${bucket.completeness === 'COMPLETE' ? 'recorded' : 'known'} RUN pieces · ${this.coverage(bucket)}`;
  }
  jumpToFirstRecordedHour(): void {
    const table = this.host.nativeElement.querySelector<HTMLElement>('.full-report-table');
    const row = this.host.nativeElement.querySelector<HTMLElement>(`[data-hour-start="${this.firstRecordedHour()}"]`);
    if (!table || !row) return;
    const header = table.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    table.scrollTop += row.getBoundingClientRect().top - table.getBoundingClientRect().top - header;
    table.focus();
  }
}
