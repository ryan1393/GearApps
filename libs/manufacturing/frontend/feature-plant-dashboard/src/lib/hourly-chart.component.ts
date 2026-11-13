import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { DanaTableDirective, DanaTableShellDirective } from '@dana/ui';
import { buildHourlyProductionChart, type HourlyProductionBucket } from '@meshforge/manufacturing/frontend/util-plant-dashboard';
import type { DsfHistoryReport } from '@meshforge/shared/domain';

let nextChartId = 0;

@Component({
  selector: 'gear-hourly-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DanaTableDirective, DanaTableShellDirective],
  templateUrl: './hourly-chart.component.html',
  styleUrl: './hourly-chart.component.css',
})
export class HourlyChartComponent {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  readonly report = input<DsfHistoryReport | null>(null);
  readonly sourceKey = input<string>();
  readonly sourceName = input('Selected source');
  readonly scaleMax = input(1);
  readonly compact = input(false);
  readonly chartId = `hourly-chart-${++nextChartId}`;
  readonly model = computed(() => buildHourlyProductionChart(this.report(), this.sourceKey()));
  readonly maximum = computed(() => Math.max(1, this.scaleMax(), this.model().maxKnownCount));
  readonly selectedIndex = signal(0);
  readonly engaged = signal(false);
  readonly width = signal(720);
  readonly selected = computed<HourlyProductionBucket | undefined>(() => this.model().buckets[Math.min(this.selectedIndex(), this.model().buckets.length - 1)]);
  readonly step = computed(() => (this.width() - 70) / Math.max(1, this.model().buckets.length));
  readonly barWidth = computed(() => Math.max(1, this.step() - 9));

  constructor() {
    afterNextRender(() => {
      const resize = (): void => this.width.set(Math.max(280, this.host.nativeElement.clientWidth || 720));
      resize();
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(resize);
        observer.observe(this.host.nativeElement);
        this.destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  x(index: number): number { return 48 + index * this.step(); }
  barHeight(bucket: HourlyProductionBucket): number { return Math.max(0, (bucket.knownCount ?? 0) / this.maximum() * 140); }
  isSelected(index: number): boolean { return this.selected()?.key === this.model().buckets[index]?.key; }
  select(index: number): void { this.selectedIndex.set(index); this.engaged.set(true); }
  labelVisible(index: number): boolean { return index % (this.width() < 400 ? 6 : 3) === 0; }
  axisLabel(bucket: HourlyProductionBucket): string { return bucket.label.replace(/ (?:EST|EDT)$/, ''); }

  countText(bucket: HourlyProductionBucket): string {
    if (bucket.knownCount === null) return bucket.completeness === 'REVIEW' ? 'Needs review · count unavailable' : 'Unknown · no captured count';
    const count = bucket.knownCount.toLocaleString('en-US');
    if (bucket.completeness === 'COMPLETE') return `${count} RUN pieces · complete hour`;
    if (bucket.completeness === 'REVIEW') return `${count} known RUN pieces · needs review`;
    return `${count} known RUN pieces · partial coverage`;
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const last = this.model().buckets.length - 1;
    const next = event.key === 'ArrowRight' ? Math.min(last, index + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : index;
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    this.select(next);
    this.host.nativeElement.querySelector<SVGElement>(`[data-hour-index="${next}"]`)?.focus();
  }
}
