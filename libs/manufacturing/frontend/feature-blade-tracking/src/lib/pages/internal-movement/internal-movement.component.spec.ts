import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BladeTrackingApiService } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { InternalMovementComponent } from './internal-movement.component';

describe('InternalMovementComponent shelf selected automatically', () => {
  const location = (serial: string, summary: string | null) => ({
    id: serial, serial_number: serial, enabled: true, department: 'CUTTERGRIND', location_type: 'SHELF',
    summary: summary ? { number: summary } : null, part_type: null, tray_count: 0, blade_count: 0, trays: [],
  });
  const tray = {
    id: 'tray-1', serial_number: 'T-1', blade_count: 24, workflow_eligibility: { internal_movement: true },
    summary: { number: '1.955FC' }, part_type: { code: 'RING' }, current_stage: { code: 'WAITING_FOR_GRINDING' },
  };

  function create(locations: ReturnType<typeof location>[], current: string | null = null) {
    const api = {
      getWorkflowTrays: jest.fn(() => of([])),
      getAllLocations: jest.fn(() => of(locations)),
      scanTray: jest.fn(() => of(tray)),
      getCurrentTrayLocation: jest.fn(() => current
        ? of({ location: locations.find((l) => l.serial_number === current) })
        : throwError(() => new HttpErrorResponse({ status: 404 }))),
      scanLocation: jest.fn((serial: string) => of(locations.find((l) => l.serial_number === serial))),
      moveTray: jest.fn(() => of({})),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: BladeTrackingApiService, useValue: api },
      { provide: GearToastService, useValue: { success: jest.fn() } },
    ] });
    return { api, component: TestBed.runInInjectionContext(() => new InternalMovementComponent()) };
  }

  it('selects the only shelf holding the tray\'s Summary and part type, and waits for Move Tray', () => {
    const { api, component } = create([
      location('CGDR-A1A', '1.955FC'),
      location('CGDR-A1B', '2.100FC'),
      location('CGFR-A1A', '1.955FC'), // finished: not for a tray waiting for grinding
      location('CGDP-A1A', '1.955FC'), // pinion
    ]);
    component.scanTray('t-1');

    expect(component.destination?.serial_number).toBe('CGDR-A1A');
    expect(component.autoSelected).toBe(true);
    expect(component.message?.text).toContain('selected automatically');
    expect(api.moveTray).not.toHaveBeenCalled();
  });

  it('selects nothing when two shelves hold the tray\'s Summary and part type', () => {
    const { component } = create([location('CGDR-A1A', '1.955FC'), location('CGDR-B2C', '1.955FC')]);
    component.scanTray('T-1');

    expect(component.destination).toBeNull();
    expect(component.message?.text).toContain('2 shelves hold Summary 1.955FC RING');
  });

  it('counts the shelf the tray is already on, and does not move it there again', () => {
    const { component } = create([location('CGDR-A1A', '1.955FC')], 'CGDR-A1A');
    component.scanTray('T-1');

    expect(component.destination).toBeNull();
    expect(component.message?.text).toContain('already on CGDR-A1A');
  });
});
