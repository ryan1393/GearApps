import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { frontendFeatureBladeTrackingRoutes } from '../../lib.routes';
import { OperationsStationComponent } from './operations-station.component';
import { BLADE_OPERATIONS } from './operations-station.operations';

describe('blade operations station', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: jest.Mock;

  function create(op: string | null): OperationsStationComponent {
    params = new BehaviorSubject(convertToParamMap(op ? { op } : {}));
    navigate = jest.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
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

  it('redirects every former operation page to its station tab', () => {
    const children = frontendFeatureBladeTrackingRoutes[0].children ?? [];
    for (const { key } of BLADE_OPERATIONS) {
      expect(children.find((route) => route.path === key)?.redirectTo).toBe(`/blades/operations?op=${key}`);
    }
  });
});
