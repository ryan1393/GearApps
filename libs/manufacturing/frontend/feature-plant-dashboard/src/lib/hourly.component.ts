import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DanaAlertDirective, DanaButtonDirective, DanaEmptyStateDirective, DanaPageHeaderComponent, DanaThemeToggleComponent } from '@dana/ui';
import { PlantHourlyDataService } from '@meshforge/manufacturing/frontend/data-access-plant-dashboard';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { buildHourlyProductionChart, historyFilterError, plantDate } from '@meshforge/manufacturing/frontend/util-plant-dashboard';
import type { DsfHistorySource } from '@meshforge/shared/domain';
import { timer } from 'rxjs';
import { HourlyChartComponent } from './hourly-chart.component';
import { FullProductionReportComponent } from './full-production-report.component';

@Component({
  selector: 'gear-plant-hourly', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, DanaAlertDirective, DanaButtonDirective, DanaEmptyStateDirective, DanaPageHeaderComponent, DanaThemeToggleComponent, HourlyChartComponent, FullProductionReportComponent],
  providers: [PlantHourlyDataService],
  templateUrl: './hourly.component.html',
  styleUrls: ['./plant-layout.css', './hourly-layout.css'],
})
export class HourlyComponent {
  private readonly data = inject(PlantHourlyDataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  private readonly timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  private initialized = false;
  readonly loading = this.data.loading;
  readonly sourcesError = this.data.sourcesError;
  readonly statusError = this.data.statusError;
  readonly status = this.data.status;
  readonly today = signal(plantDate());
  readonly clock = signal(Date.now());
  readonly date = signal(plantDate());
  readonly followToday = signal(true);
  readonly department = signal('');
  readonly candidateKey = signal('');
  readonly includeInactive = signal(false);
  readonly wallMode = signal(false);
  readonly viewMode = signal<'hourly' | 'full'>('hourly');
  readonly focusedSourceKey = signal('');
  readonly selectedSources = signal<DsfHistorySource[]>([]);
  readonly selectionError = signal('');
  readonly shownDate = computed(() => this.data.query()?.date ?? this.date());
  readonly captureHealth = computed(() => {
    const collector = this.status();
    if (this.statusError() || !collector) return 'Source capture status unavailable';
    if (!collector.enabled || !collector.source_reader_enabled) return 'Collection disabled · saved history retained';
    if (collector.last_failure_code) return 'Source capture needs attention';
    if (!collector.last_success_at) return 'Waiting for the first source capture';
    if (this.clock() - Date.parse(collector.last_success_at) > Math.max(180, collector.interval_seconds * 3) * 1000) return 'Source capture delayed';
    return 'Source capture current';
  });
  readonly dateError = computed(() => historyFilterError({ from: this.date(), to: this.date(), group: 'hour', source_key: '', department_id: '', include_inactive: false }) || (this.date() > this.today() ? 'Choose a date up to today in Indianapolis.' : ''));
  readonly catalog = computed(() => this.data.sources()?.sources ?? []);
  readonly departments = computed(() => [...new Set(this.catalog().map(source => source.department_name || 'Unassigned department'))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  readonly availableSources = computed(() => this.sorted(this.catalog().filter(source =>
    (this.includeInactive() || source.active && source.current) &&
    (!this.department() || (source.department_name || 'Unassigned department') === this.department()) &&
    !this.selectedSources().some(selected => selected.source_key === source.source_key))));
  readonly cutterGrind = computed(() => this.sorted(this.catalog().filter(source => source.active && source.current && this.isCutterGrind(source))));
  readonly cards = computed(() => this.selectedSources().map(selected => {
    const source = this.catalog().find(item => item.source_key === selected.source_key) ?? selected;
    const result = this.data.results().find(item => item.source_key === source.source_key);
    return { source, report: result?.report ?? null, error: result?.error ?? '', chart: buildHourlyProductionChart(result?.report ?? null, source.source_key) };
  }));
  readonly focusedCard = computed(() => this.cards().find(card => card.source.source_key === this.focusedSourceKey()) ?? this.cards()[0] ?? null);
  readonly scaleMax = computed(() => {
    const largest = Math.max(0, ...this.cards().map(card => card.chart.maxKnownCount));
    const step = largest <= 10 ? 1 : largest <= 50 ? 5 : largest <= 100 ? 10 : Math.pow(10, Math.floor(Math.log10(largest)) - 1) * 5;
    return Math.max(1, Math.ceil(largest / step) * step);
  });

  constructor() {
    effect(() => {
      const sources = this.catalog();
      if (!this.initialized && sources.some(source => source.active && source.current)) untracked(() => {
        this.initialized = true;
        this.selectedSources.set(this.sorted(sources.filter(source => source.active && source.current)).slice(0, 4));
        this.applySelection();
      });
    });
    timer(30_000, 30_000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const current = plantDate();
      this.clock.set(Date.now());
      this.today.set(current);
      if (this.followToday() && this.date() !== current) { this.date.set(current); this.applySelection(); }
    });
  }

  private isCutterGrind(source: DsfHistorySource): boolean { return source.department_name.replace(/\s/g, '').toUpperCase() === 'CUTTERGRIND'; }
  private sorted(sources: DsfHistorySource[]): DsfHistorySource[] {
    return [...sources].sort((a, b) => Number(this.isCutterGrind(b)) - Number(this.isCutterGrind(a)) || a.source_name.localeCompare(b.source_name, undefined, { numeric: true }));
  }
  private applySelection(): void {
    this.selectionError.set('');
    try { this.data.applyQuery({ date: this.date(), source_keys: this.selectedSources().map(source => source.source_key), include_inactive: this.includeInactive() }); }
    catch (error) { this.selectionError.set(error instanceof Error ? error.message : 'The selected sources could not be loaded.'); }
  }
  setDate(value: string): void { this.followToday.set(false); this.date.set(value); this.applySelection(); }
  useToday(): void { this.followToday.set(true); this.date.set(this.today()); this.applySelection(); }
  addSource(): void {
    if (this.selectedSources().length >= 6) { this.selectionError.set('Choose up to six sources on one screen. Remove one before adding another.'); return; }
    const source = this.availableSources().find(item => item.source_key === this.candidateKey());
    if (!source) return;
    this.initialized = true;
    this.selectedSources.update(current => [...current, source]); this.candidateKey.set(''); this.applySelection();
  }
  removeSource(key: string): void { this.initialized = true; this.selectedSources.update(current => current.filter(source => source.source_key !== key)); this.applySelection(); }
  clearSelection(): void { this.initialized = true; this.selectedSources.set([]); this.applySelection(); }
  selectCutterGrind(): void { if (!this.cutterGrind().length || this.cutterGrind().length > 6) return; this.initialized = true; this.selectedSources.set(this.cutterGrind()); this.candidateKey.set(''); this.applySelection(); }
  setIncludeInactive(value: boolean): void {
    this.includeInactive.set(value);
    if (!value) this.selectedSources.update(current => current.filter(source => {
      const latest = this.catalog().find(item => item.source_key === source.source_key) ?? source;
      return latest.active && latest.current;
    }));
    this.candidateKey.set(''); this.applySelection();
  }
  sourceLabel(source: DsfHistorySource): string { return `${source.source_name}${!source.current ? ' · Earlier identity' : !source.active ? ' · Inactive' : ''}`; }
  setViewMode(mode: 'hourly' | 'full'): void { this.viewMode.set(mode); }
  focusSource(key: string): void { if (this.cards().some(card => card.source.source_key === key)) this.focusedSourceKey.set(key); }
  formatTime(value: string | null): string { return value && Number.isFinite(Date.parse(value)) ? this.timeFormatter.format(Date.parse(value)) : 'Not captured'; }
  refresh(): void { this.data.refresh(); }
  logout(): void { this.session.logout(); void this.router.navigateByUrl('/login'); }
}
