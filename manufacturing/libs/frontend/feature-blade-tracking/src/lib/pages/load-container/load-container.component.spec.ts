import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { BladeTrackingApiService, InventoryLookupResult } from '@gearapps/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@gearapps/manufacturing/frontend/util-common';
import { IContainer } from '@gearapps/manufacturing/shared/util-types';
import { LoadContainerComponent } from './load-container.component';
import { InventoryLookupComponent } from '../inventory-lookup/inventory-lookup.component';

describe('Blade inventory selection safety', () => {
  it('clears a previously selected container when replacement lookup fails', () => {
    const api = { getWorkflowContainers: () => of([]), getWorkflowTrays: () => of([]),
      scanContainer: () => throwError(() => new HttpErrorResponse({ status: 404 })) };
    TestBed.configureTestingModule({ providers: [{ provide: BladeTrackingApiService, useValue: api }, { provide: GearToastService, useValue: {} }] });
    const component = TestBed.runInInjectionContext(() => new LoadContainerComponent());
    component.container = { id: 'old', serial_number: 'OLD' } as IContainer;
    component.scanContainer('MISSING'); expect(component.container).toBeNull(); expect(component.trays).toEqual([]);
  });
  it('does not replace a newer lookup result with a late response', () => {
    const first = new Subject<InventoryLookupResult>(); const second = new Subject<InventoryLookupResult>();
    const api = { lookup: jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    TestBed.configureTestingModule({ providers: [{ provide: BladeTrackingApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } }] });
    const component = TestBed.runInInjectionContext(() => new InventoryLookupComponent());
    component.lookup('OLD'); component.lookup('NEW');
    const latest = { kind: 'tray', value: { serial_number: 'NEW' } } as InventoryLookupResult;
    second.next(latest); first.next({ kind: 'tray', value: { serial_number: 'OLD' } } as InventoryLookupResult);
    expect(component.result).toBe(latest);
  });
});
