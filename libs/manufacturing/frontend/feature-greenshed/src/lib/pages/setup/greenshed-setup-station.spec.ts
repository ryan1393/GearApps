import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { GreenshedApiService, GreenshedBuild } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { GreenshedSetupComponent } from './greenshed-setup.component';

const ready = { id: 'b', build_number: 'BUILD-A', build_increment: 1, cutter_body_serial_number: 'BODY', summary_number: '123', summary_model: '',
  part_type_code: 'RING', status_code: 'READY', built_at: '', machine_run: null, shelf_location: null } as GreenshedBuild;

describe('Greenshed Machine Setup as a scan station', () => {
  let api: Record<string, jest.Mock>;
  function render(params: Record<string, string> = {}) {
    api = {
      getDashboard: jest.fn(() => of({ available_cutters: [{ build_number: 'BUILD-A', summary_number: '123', part_type_code: 'RING' }] })),
      getRunningMachines: jest.fn(() => of({ departments: [{ department_code: '152', machines: [{ machine_number: 'M7', machine_active: true, has_cutter: false }] }] })),
      listParts: jest.fn(() => of([{ part_number: 'P1', active: true, enabled: true, summary: { number: '123' }, part_type: { code: 'RING', name: 'Ring' } }])),
      getBuild: jest.fn(() => of(ready)),
      getMachine: jest.fn(() => of({ machine_number: 'M7', machine_active: true, active_run: null, department_code: '152', cell: 2 })),
      getPartByNumber: jest.fn(() => of({ part_number: 'P1', active: true, summary: { number: '123' }, part_type: { code: 'RING', name: 'Ring' } })),
      setupCutter: jest.fn(() => of({ build_number: 'BUILD-A', machine_number: 'M7', next_check_piece_count: 25 })),
    };
    TestBed.configureTestingModule({
      imports: [GreenshedSetupComponent],
      providers: [
        { provide: GreenshedApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(convertToParamMap(params)) } },
        { provide: GearToastService, useValue: { success: jest.fn(), error: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(GreenshedSetupComponent);
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('numbers scan-or-pick steps for build, machine and part, with the status line above them', () => {
    const fixture = render();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('gear-station-status')).toBeTruthy();
    const steps = Array.from(host.querySelectorAll('gear-scan-panel input[data-gear-scan-step]')).map((input) => input.getAttribute('data-gear-scan-step'));
    expect(steps).toEqual(['1', '2', '3']);
    expect(host.querySelectorAll('gear-option-picker').length).toBe(3);
    fixture.destroy();
  });

  it('runs the same lookups as before and explains why Setup Cutter is blocked at each step', () => {
    const fixture = render();
    const c = fixture.componentInstance;
    expect(c.setupBlockedReason).toContain('cutter build first');
    c.useBuild(' BUILD-A ');
    expect(api['getBuild']).toHaveBeenCalledWith('BUILD-A');
    expect(c.setupBlockedReason).toContain('machine');
    c.useMachine('M7');
    expect(api['getMachine']).toHaveBeenCalledWith('M7');
    expect(c.setupBlockedReason).toContain('part');
    c.usePart('P1');
    expect(api['getPartByNumber']).toHaveBeenCalledWith('P1');
    expect(c.setupBlockedReason).toBe('');
    expect(c.prompt).toContain('Setup Cutter');
    c.setup();
    expect(api['setupCutter']).toHaveBeenCalledWith(expect.objectContaining({ buildNumber: 'BUILD-A', machineNumber: 'M7', partNumber: 'P1' }));
    expect(c.status).toEqual({ tone: 'success', text: 'BUILD-A setup on M7.' });
    fixture.destroy();
  });

  it('Change on the build clears the machine and part after it', () => {
    const fixture = render();
    const c = fixture.componentInstance;
    c.useBuild('BUILD-A'); c.useMachine('M7'); c.usePart('P1');
    c.changeBuild();
    expect(c.build).toBeNull();
    expect(c.machine).toBeNull();
    expect(c.part).toBeNull();
    fixture.destroy();
  });

  it('keeps a machine chosen on Running Machines locked', () => {
    const fixture = render({ origin: 'running-machines', machine: 'M7' });
    const c = fixture.componentInstance;
    c.useBuild('BUILD-A');
    expect(api['getMachine']).toHaveBeenCalledWith('M7');
    c.changeMachine();
    expect(c.machine?.machine_number).toBe('M7');
    c.useMachine('M9');
    expect(api['getMachine']).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('says in the status line when a scan made too early was not used', () => {
    const fixture = render();
    fixture.componentInstance.scanIgnored('M7');
    expect(fixture.componentInstance.status?.text).toContain('Scan M7 ignored');
    fixture.destroy();
  });
});
