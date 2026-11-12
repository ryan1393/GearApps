import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { BladeTrackingApiService } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { GrindingComponent } from './grinding/grinding.component';
import { BladeLocationsComponent } from './locations/blade-locations.component';
import { ScrapBladesComponent } from './scrap-blades/scrap-blades.component';

/** A slow earlier answer must never replace a newer list. */
describe('Blade Tracking lists ignore stale answers', () => {
  let api: Record<string, jest.Mock>;
  const page = (id: string, hasNextPage = false) => ({ data: [{ id, serial_number: id }], meta: { page: 1, hasNextPage, totalItems: 1 } });

  beforeEach(() => {
    api = { getWorkflowTrays: jest.fn(), getScrappedBlades: jest.fn(), getLocations: jest.fn() };
    TestBed.configureTestingModule({ providers: [
      { provide: BladeTrackingApiService, useValue: api },
      { provide: GearToastService, useValue: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() } },
    ] });
  });

  it('Grinding tray picker', () => {
    const first = new Subject<unknown[]>(), second = new Subject<unknown[]>();
    api['getWorkflowTrays'].mockReturnValueOnce(first).mockReturnValueOnce(second);
    const grinding = TestBed.runInInjectionContext(() => new GrindingComponent());
    grinding.refreshPickers(); grinding.refreshPickers();
    second.next([{ serial_number: 'NEW' }]);
    first.next([{ serial_number: 'OLD' }]);
    first.error(new Error('late failure'));
    expect(grinding.availableTrays.map((tray) => tray.serial_number)).toEqual(['NEW']);
    expect(grinding.pickerError).toBe('');
    grinding.ngOnDestroy();
  });

  it('Scrap Blades pages', () => {
    const first = new Subject<unknown>(), second = new Subject<unknown>();
    api['getScrappedBlades'].mockReturnValueOnce(first).mockReturnValueOnce(second);
    const scrap = TestBed.runInInjectionContext(() => new ScrapBladesComponent());
    scrap.loadPage(1); scrap.loadPage(2);
    second.next(page('PAGE-2'));
    first.next(page('PAGE-1'));
    expect(scrap.rows.map((row) => row.id)).toEqual(['PAGE-2']);
    expect(scrap.loading).toBe(false);
  });

  it('Locations refresh', () => {
    const first = new Subject<unknown>(), second = new Subject<unknown>();
    api['getLocations'].mockReturnValueOnce(first).mockReturnValueOnce(second);
    const locations = TestBed.runInInjectionContext(() => new BladeLocationsComponent());
    locations.refresh(); locations.refresh();
    second.next(page('NEW'));
    first.next(page('OLD'));
    expect(locations.rows.map((row) => row.id)).toEqual(['NEW']);
    expect(locations.loading).toBe(false);
  });
});
