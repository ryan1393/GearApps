import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlantHourlyDataService, type PlantHourlyQuery, type PlantHourlySourceResult } from '@meshforge/manufacturing/frontend/data-access-plant-dashboard';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import type { DsfHistorySource, DsfHistorySourceSnapshot } from '@meshforge/shared/domain';
import { HourlyComponent } from './hourly.component';

const source = (index: number, changes: Partial<DsfHistorySource> = {}): DsfHistorySource => ({
  source_key: index.toString(16).padStart(64, '0'), mapping_id: `mapping-${index}`, whiteboard_id: `board-${index}`,
  op_id: `operation-${index}`, line_id: `line-${index}`, department_id: 'cutter', source_name: `CutGrind ${index}`,
  line_name: `CutGrind ${index}`, department_name: 'CUTTER GRIND', asset_number: null, active: true, current: true,
  duplicate_operation: false, review_reason: null, machine_id: null, machine_number: null, last_seen_at: '2026-11-11T23:00:00Z', ...changes,
});

describe('Multi-machine hourly selection', () => {
  const sources = signal<DsfHistorySourceSnapshot | null>(null);
  const query = signal<PlantHourlyQuery | null>(null);
  const results = signal<PlantHourlySourceResult[]>([]);
  const data = { sources, query, results, sourcesError: signal(''), status: signal(null), statusError: signal(''),
    loading: signal(false), applyQuery: jest.fn((value: PlantHourlyQuery) => {
      if (!value.date || value.date === '2026-02-30') { query.set(null); results.set([]); throw new Error('Choose a valid date up to today in Indianapolis.'); }
      query.set(value);
    }), refresh: jest.fn() };
  const snapshot = (entries: DsfHistorySource[]): void => sources.set({ format: 'DSFHISTORYSOURCES1', available: true, served_at: '2026-11-11T23:00:00Z', sources: entries });

  function create() {
    TestBed.configureTestingModule({ imports: [HourlyComponent], providers: [
      { provide: AuthSessionService, useValue: { logout: jest.fn() } }, { provide: Router, useValue: { navigateByUrl: jest.fn() } },
    ] });
    TestBed.overrideComponent(HourlyComponent, { set: { template: '', providers: [{ provide: PlantHourlyDataService, useValue: data }] } });
    const fixture = TestBed.createComponent(HourlyComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance, fixture };
  }

  afterEach(() => { TestBed.resetTestingModule(); sources.set(null); query.set(null); results.set([]); data.applyQuery.mockClear(); });

  it('starts with four active sources, prioritizes Cutter Grind, and does not repopulate a deliberate clear', () => {
    snapshot([source(9, { department_name: 'Thread Draw' }), ...[1, 2, 3, 4, 5].map(index => source(index)), source(6, { active: false })]);
    const { component, fixture } = create();
    expect(component.selectedSources().map(item => item.source_name)).toEqual(['CutGrind 1', 'CutGrind 2', 'CutGrind 3', 'CutGrind 4']);
    expect(query()?.source_keys).toHaveLength(4);
    component.clearSelection();
    snapshot([source(1), source(2)]); fixture.detectChanges();
    expect(component.cards()).toHaveLength(0);
    expect(query()?.source_keys).toEqual([]);
  });

  it('filters available choices without changing selected charts and selects all five Cutter Grind sources', () => {
    snapshot([...Array.from({ length: 5 }, (_, index) => source(index + 1)), source(9, { department_name: 'Thread Draw' })]);
    const { component } = create();
    component.department.set('Thread Draw');
    expect(component.availableSources().map(item => item.source_key)).toEqual([source(9).source_key]);
    expect(component.cards()).toHaveLength(4);
    component.selectCutterGrind();
    expect(query()?.source_keys).toEqual([1, 2, 3, 4, 5].map(index => source(index).source_key));
    expect(query()?.source_keys).toHaveLength(5);
  });

  it('limits selection to six and excludes inactive streams when the inactive option is turned off', () => {
    snapshot(Array.from({ length: 8 }, (_, index) => source(index + 1, index === 7 ? { active: false, current: false } : {})));
    const { component } = create();
    component.setIncludeInactive(true);
    component.candidateKey.set(source(8).source_key); component.addSource();
    component.candidateKey.set(source(5).source_key); component.addSource();
    component.candidateKey.set(source(6).source_key); component.addSource();
    expect(component.selectedSources()).toHaveLength(6);
    expect(component.selectionError()).toContain('six');
    component.setIncludeInactive(false);
    expect(component.selectedSources().some(item => !item.active || !item.current)).toBe(false);
    expect(query()?.include_inactive).toBe(false);
  });

  it('keeps source identity and its last label when a catalog refresh drops the selected source', () => {
    snapshot([source(1)]);
    const { component, fixture } = create();
    snapshot([]); fixture.detectChanges();
    expect(component.cards()[0].source.source_key).toBe(source(1).source_key);
    expect(component.cards()[0].source.source_name).toBe('CutGrind 1');
  });

  it('fixes a historical date, rejects invalid date changes, and reports safe service validation failures', () => {
    snapshot([source(1)]);
    const { component } = create();
    component.setDate('2026-11-01');
    expect(query()?.date).toBe('2026-11-01');
    expect(component.followToday()).toBe(false);
    component.setDate('2026-02-30');
    expect(component.dateError()).toBeTruthy();
    expect(query()).toBeNull();
    component.setDate(''); component.clearSelection();
    expect(query()).toBeNull();
    expect(data.applyQuery).toHaveBeenLastCalledWith({ date: '', source_keys: [], include_inactive: false });
    data.applyQuery.mockImplementationOnce(() => { throw new Error('Choose each machine once from the source list.'); });
    component.setDate('2026-11-02');
    expect(component.selectionError()).toContain('Choose each machine once');
  });
});
