import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BladeTrackingApiService } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { ReceiveContainerComponent } from './receive-container.component';

describe('ReceiveContainerComponent', () => {
  const finished = (serial: string, summary: string | null, trayCount = 0) => ({
    id: serial, serial_number: serial, enabled: true, department: 'CUTTERGRIND', location_type: 'SHELF',
    summary: summary ? { number: summary } : null, part_type: null, tray_count: trayCount,
  });

  function create(locations: unknown[] = []): ReceiveContainerComponent {
    const tray = (id: string) => ({ id: 'ct-' + id, tray_id: id, enabled: true, tray: { id, serial_number: id, blade_count: 24 } });
    const api = {
      getWorkflowContainers: jest.fn(() => of([])),
      getAllLocations: jest.fn(() => of(locations)),
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

  describe('finished shelf selected automatically', () => {
    const pending = { id: 'T-1', serial_number: 'T-1', summary: { number: '1.955FC' }, part_type: { code: 'RING' } };

    it('offers the only empty shelf holding the tray\'s Summary and part type', () => {
      const component = create([
        finished('CGFR-A1A', '1.955FC'),
        finished('CGFR-A1B', '1.955FC', 1), // full: not offered
        finished('CGFR-A1C', '2.100FC'),
        finished('CGFP-A1A', '1.955FC'),
      ]);
      component.container = { id: 'c1', serial_number: 'C0012' } as never;
      component.pendingTray = pending as never;
      expect(component.autoShelf.shelf?.serial_number).toBe('CGFR-A1A');
      expect(component.prompt).toContain('tap Receive onto CGFR-A1A');
    });

    it('selects none when two empty shelves hold them', () => {
      const component = create([finished('CGFR-A1A', '1.955FC'), finished('CGFR-B1A', '1.955FC')]);
      component.container = { id: 'c1', serial_number: 'C0012' } as never;
      component.pendingTray = pending as never;
      expect(component.autoShelf.shelf).toBeNull();
      expect(component.autoShelf.matches).toHaveLength(2);
      expect(component.prompt).toContain('scan the shelf tag');
    });
  });
});
