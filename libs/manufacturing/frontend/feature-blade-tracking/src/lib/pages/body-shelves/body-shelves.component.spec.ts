import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BladeTrackingApiService, EmptyBodyShelfView } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { BodyShelvesComponent } from './body-shelves.component';

describe('Empty body shelves confirmation', () => {
  let api: Record<string, jest.Mock>;
  let component: BodyShelvesComponent;
  beforeEach(() => {
    api = {
      getEmptyBodyShelves: jest.fn(() => of([])),
      placeEmptyBodyShelf: jest.fn(() => of({})),
      removeEmptyBodyShelf: jest.fn(() => of({})),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: BladeTrackingApiService, useValue: api },
      { provide: GearToastService, useValue: { success: jest.fn() } },
    ] });
    component = TestBed.runInInjectionContext(() => new BodyShelvesComponent());
    jest.spyOn(globalThis, 'confirm').mockImplementation(() => { throw new Error('native confirm must not be used'); });
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks in the Dana dialog before recording a placement, and records only on confirm', () => {
    component.bodyIdentifier = ' cgrt076aaa '; component.shelfSerial = 'body-a1';
    component.place();
    expect(api['placeEmptyBodyShelf']).not.toHaveBeenCalled();
    expect(component.confirmationMessage).toContain('CGRT076AAA is physically on shelf BODY-A1');
    component.confirm();
    expect(api['placeEmptyBodyShelf']).toHaveBeenCalledWith('CGRT076AAA', 'BODY-A1');
    expect(component.confirmation).toBeNull();
  });

  it('does nothing when the removal is canceled', () => {
    component.remove({ body_serial: 'B1', placement_id: 'p1' } as EmptyBodyShelfView);
    expect(component.confirmationTitle).toBe('Remove shelf observation?');
    component.confirmation = null;
    component.confirm();
    expect(api['removeEmptyBodyShelf']).not.toHaveBeenCalled();
  });
});
