import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { frontendFeatureBladeTrackingRoutes } from '../../lib.routes';
import { OperationsStationComponent } from './operations-station.component';
import { BLADE_OPERATIONS } from './operations-station.operations';

describe('blade operations station', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: jest.Mock;

  function create(op: string | null, permissions: string[] | null = null, extra: Record<string, string> = {}): OperationsStationComponent {
    params = new BehaviorSubject(convertToParamMap(op ? { op, ...extra } : extra));
    navigate = jest.fn(() => Promise.resolve(true));
    const identity = { role: 'user', permissions };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: { currentUser: identity, authState$: new BehaviorSubject(identity) } },
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
      ],
    });
    return TestBed.runInInjectionContext(() => new OperationsStationComponent());
  }

  beforeEach(() => localStorage.clear());

  it('opens the operation named in the URL and follows later changes', () => {
    const station = create('grinding');
    expect(station.active()).toBe('grinding');
    params.next(convertToParamMap({ op: 'receive-container' }));
    expect(station.active()).toBe('receive-container');
  });

  it('reopens on the last operation used at this workstation', () => {
    localStorage.setItem('meshforge.blade-tracking.operations-station', 'load-container');
    expect(create(null).active()).toBe('load-container');
  });

  it('falls back to intake for an unknown operation', () => {
    expect(create('not-an-operation').active()).toBe('intake');
  });

  it('switches tabs through the URL without adding history entries', () => {
    const station = create('intake');
    station.select('internal-movement');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { op: 'internal-movement' }, replaceUrl: true }));
    navigate.mockClear();
    station.select('intake');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets a workstation hide tabs it does not use, but never the open one or the last one', () => {
    const station = create('intake');
    station.toggleTab('coater-shipments');
    station.toggleTab('intake');
    expect(station.shownOperations().map((op) => op.key)).not.toContain('coater-shipments');
    expect(station.shownOperations().map((op) => op.key)).toContain('intake');
    expect(localStorage.getItem('meshforge.blade-tracking.operations-station.hidden-tabs')).toBe('coater-shipments,intake');
    for (const { key } of BLADE_OPERATIONS) if (!station.hidden().has(key)) station.toggleTab(key);
    expect(BLADE_OPERATIONS.length - station.hidden().size).toBe(1);
    const lastShown = BLADE_OPERATIONS.find(({ key }) => !station.hidden().has(key));
    expect(lastShown && station.isOnlyShownTab(lastShown.key)).toBe(true);
  });

  it('does not open or show an operation outside an assigned role, even through a saved URL', () => {
    const station = create('grinding', ['bladeTrays:createBladeBatch']);
    expect(station.active()).toBe('intake');
    expect(station.shownOperations().map(row => row.key)).toEqual(['intake']);
    expect(station.allowed('grinding')).toBe(false);
  });

  it('opens grinding for an account allowed to complete an existing grind', () => {
    const station = create('grinding', ['trays:completeGrinding']);
    expect(station.active()).toBe('grinding');
    expect(station.shownOperations().map(row => row.key)).toEqual(['grinding']);
  });

  it('numbers the main tray flow and leaves Internal Movement outside it', () => {
    expect(BLADE_OPERATIONS.map((op) => op.flowStep)).toEqual([1, 2, 3, 4, 5, null]);
    expect(new Set(BLADE_OPERATIONS.map((op) => op.icon)).size).toBe(BLADE_OPERATIONS.length);
  });

  it('redirects every former operation page to its station tab', () => {
    const children = frontendFeatureBladeTrackingRoutes[0].children ?? [];
    for (const { key } of BLADE_OPERATIONS) {
      expect(children.find((route) => route.path === key)?.redirectTo).toBe(`/blades/operations?op=${key}`);
    }
  });

  it('passes a tray named by another app (?tray=) to the Grinding tab', () => {
    const station = create('grinding', null, { tray: 'T0042' });
    expect(station.active()).toBe('grinding');
    expect(station.requestedTray()).toBe('T0042');
  });
});
