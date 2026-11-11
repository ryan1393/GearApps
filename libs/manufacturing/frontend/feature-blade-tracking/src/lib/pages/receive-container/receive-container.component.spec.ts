import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BladeTrackingApiService } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { ReceiveContainerComponent } from './receive-container.component';

describe('ReceiveContainerComponent', () => {
  function create(): ReceiveContainerComponent {
    const tray = (id: string) => ({ id: 'ct-' + id, tray_id: id, enabled: true, tray: { id, serial_number: id, blade_count: 24 } });
    const api = {
      getWorkflowContainers: jest.fn(() => of([])),
      getAllLocations: jest.fn(() => of([])),
      scanContainer: jest.fn(() => of({ id: 'c1', serial_number: 'C0012', workflow_eligibility: { receive: true } })),
      getActiveContainerTrays: jest.fn(() => of([tray('T-1'), tray('T-2')])),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: BladeTrackingApiService, useValue: api },
      { provide: GearToastService, useValue: { success: jest.fn() } },
    ] });
    return TestBed.runInInjectionContext(() => new ReceiveContainerComponent());
  }

  it('can stop receiving a container with trays still expected, and says how to continue', () => {
    const component = create();
    component.scanContainer('c0012');
    expect(component.inProgress).toBe(true);
    expect(component.finishBlockedReason).toContain('2 trays are still expected');

    component.stopReceiving();

    expect(component.container).toBeNull();
    expect(component.expected).toEqual([]);
    expect(component.inProgress).toBe(false);
    expect(component.message).toEqual({ tone: 'info', text: 'Stopped receiving C0012: 0 received, 2 still expected. Scan it again to continue.' });
  });
});
