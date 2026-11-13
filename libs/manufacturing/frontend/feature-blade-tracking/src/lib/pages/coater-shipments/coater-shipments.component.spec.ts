import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { CoaterAvailableContainer, CoaterShipment } from '@meshforge/manufacturing/shared/util-types';
import { CoaterShipmentsApiService } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { CoaterShipmentsComponent } from './coater-shipments.component';

describe('Coater shipment available-container search', () => {
  function setup(requests: Subject<CoaterAvailableContainer[]>[]) {
    const available = jest.fn(); for (const request of requests) available.mockReturnValueOnce(request);
    TestBed.configureTestingModule({ providers: [{ provide: CoaterShipmentsApiService, useValue: {
      list: () => of({ rows: [], total: 0, page: 1, page_size: 25 }), available,
    } }] });
    const component = TestBed.runInInjectionContext(() => new CoaterShipmentsComponent());
    component.active = { id: 'draft', revision: 1, status: 'DRAFT' } as CoaterShipment;
    return component;
  }

  it('keeps the newest search when an earlier result arrives late', () => {
    const old = new Subject<CoaterAvailableContainer[]>(), latest = new Subject<CoaterAvailableContainer[]>();
    const component = setup([old, latest]);
    component.refreshAvailable(); component.availableQuery = 'NEW'; component.refreshAvailable();
    latest.next([{ serial: 'NEW' } as CoaterAvailableContainer]); old.next([{ serial: 'OLD' } as CoaterAvailableContainer]);
    expect(component.availableContainers.map(row => row.serial)).toEqual(['NEW']); expect(component.availableLoading).toBe(false);
    component.ngOnDestroy();
  });

  it('does not repopulate choices after returning to the shipment list', () => {
    const request = new Subject<CoaterAvailableContainer[]>(); const component = setup([request]);
    component.refreshAvailable(); component.close(); request.next([{ serial: 'OLD' } as CoaterAvailableContainer]);
    expect(component.active).toBeNull(); expect(component.availableContainers).toEqual([]); expect(component.availableLoading).toBe(false);
    component.ngOnDestroy();
  });
});
