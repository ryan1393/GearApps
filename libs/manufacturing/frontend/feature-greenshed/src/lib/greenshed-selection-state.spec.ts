import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import {
  GreenshedApiService,
  GreenshedBuild,
} from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { GreenshedMachinesComponent } from './pages/machines/greenshed-machines.component';
import { GreenshedPullComponent } from './pages/pull/greenshed-pull.component';
import { GreenshedCheckComponent } from './pages/check/greenshed-check.component';
import { GreenshedSetupComponent } from './pages/setup/greenshed-setup.component';
import { GreenshedLookupComponent } from './pages/lookup/greenshed-lookup.component';

const build = (
  number = 'BUILD-A',
  machine = 'M1',
  run = 'run-1',
): GreenshedBuild => ({
  id: number,
  build_number: number,
  build_increment: 1,
  cutter_body_serial_number: 'BODY',
  summary_number: '123',
  summary_model: '',
  part_type_code: 'RING',
  status_code: 'RUNNING',
  built_at: '',
  shelf_location: null,
  machine_run: {
    id: run,
    machine_number: machine,
    part_number: 'PART',
    current_piece_count: 10,
    last_check_piece_count: 0,
    next_check_piece_count: 25,
    installed_at: '',
  },
});
const reasons = [
  {
    id: 'teardown',
    code: 'TEARDOWN',
    name: 'Teardown',
    description: '',
    requires_teardown: true,
    returns_to_shelf: false,
  },
  {
    id: 'change',
    code: 'PCR_002',
    name: 'Changeover',
    description: '',
    requires_teardown: false,
    returns_to_shelf: true,
  },
];
describe('Greenshed selected context safety', () => {
  let api: { [key: string]: jest.Mock };
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  function setup(params: Record<string, string> = {}) {
    query = new BehaviorSubject(convertToParamMap(params));
    api = {
      getDashboard: jest.fn(() => of({ active_machines: [], available_cutters: [] })),
      getReferenceData: jest.fn(() =>
        of({ pull_reasons: reasons, check_types: [], check_results: [] }),
      ),
      getBuild: jest.fn(() => of(build())),
      getHistory: jest.fn(() => of([])),
      searchBuilds: jest.fn(() => of([])),
      scanLocation: jest.fn(),
      pullCutter: jest.fn(() => of({ status_code: 'PULLED' })),
      qualityCheck: jest.fn(() => of({})),
      getRunningMachines: jest.fn(() => of({ departments: [] })),
      getDsfCounts: jest.fn(() => of({ format: 'DSFCOUNT1', configured: false, rows: [] })),
      getMachine: jest.fn(),
      getPartByNumber: jest.fn(),
      listParts: jest.fn(() => of([])),
      setupCutter: jest.fn(() => of({})),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: GreenshedApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { queryParamMap: query } },
        {
          provide: GearToastService,
          useValue: {
            success: jest.fn(),
            error: jest.fn(),
            warning: jest.fn(),
          },
        },
      ],
    });
  }
  function pull() {
    const component = TestBed.runInInjectionContext(
      () => new GreenshedPullComponent(),
    );
    component.ngOnInit();
    return component;
  }
  afterEach(() => jest.restoreAllMocks());
  it('clears a previous pull selection when its replacement scan fails', () => {
    setup();
    const c = pull();
    c.buildNumber = 'BUILD-A';
    c.scanBuild();
    expect(c.contextValid).toBe(true);
    const pending = new Subject<GreenshedBuild>();
    api['getBuild'].mockReturnValue(pending);
    c.buildNumber = 'MISSING';
    c.scanBuild();
    expect(c.build).toBeNull();
    pending.error(new HttpErrorResponse({ status: 404 }));
    c.pull();
    expect(api['pullCutter']).not.toHaveBeenCalled();
  });
  it('invalidates a pull selection as soon as the identifier is edited', () => {
    setup();
    const c = pull();
    c.buildNumber = 'BUILD-A';
    c.scanBuild();
    c.buildNumber = 'OTHER';
    c.onBuildInput();
    expect(c.contextValid).toBe(false);
    expect(c.build).toBeNull();
  });
  it('clears a pull selection when an empty picker is selected', () => {
    setup();
    const c = pull();
    c.buildNumber = 'BUILD-A';
    c.scanBuild();
    c.buildNumber = '';
    c.selectBuild();
    expect(c.build).toBeNull();
  });
  it('rejects a cutter that has moved to another machine run since navigation', () => {
    setup({
      origin: 'running-machines',
      build: 'BUILD-A',
      machine: 'M1',
      run: 'old-run',
    });
    const c = pull();
    expect(c.contextValid).toBe(false);
    expect(c.error).toContain('run has changed');
    expect(c.build).toBeNull();
  });
  it('requires a valid running machine context for navigation-locked pulls', () => {
    setup({ origin: 'running-machines', build: 'BUILD-A' });
    const c = pull();
    expect(c.contextValid).toBe(false);
    expect(api['getBuild']).not.toHaveBeenCalled();
  });
  it('ignores a superseded build response after changing route context', () => {
    setup();
    const a = new Subject<GreenshedBuild>(),
      b = new Subject<GreenshedBuild>();
    api['getBuild'].mockReturnValueOnce(a).mockReturnValueOnce(b);
    const c = pull();
    query.next(convertToParamMap({ build: 'BUILD-A' }));
    query.next(convertToParamMap({ build: 'BUILD-B' }));
    a.next(build());
    expect(c.build).toBeNull();
    b.next(build('BUILD-B'));
    expect(c.build?.build_number).toBe('BUILD-B');
  });
  it('keeps the configured return-to-shelf reason when scanning the selected cutter', () => {
    setup({ build: 'BUILD-A', reason: 'CHANGEOVER' });
    const c = pull();
    expect(c.reasonCode).toBe('PCR_002');
    c.scanBuild();
    expect(c.reasonCode).toBe('PCR_002');
  });
  it('clears the previous shelf before a replacement lookup and leaves it cleared on failure', () => {
    setup({ build: 'BUILD-A', reason: 'CHANGEOVER' });
    const c = pull();
    c.shelf = { serial_number: 'GSR-123' } as never;
    c.shelfSerial = 'MISSING';
    const pending = new Subject<never>();
    api['scanLocation'].mockReturnValue(pending);
    c.scanShelf();
    expect(c.shelf).toBeNull();
    pending.error(new HttpErrorResponse({ status: 404 }));
    expect(c.shelf).toBeNull();
  });
  it('does not preselect a pull reason and refuses to pull until one is chosen', () => {
    setup({ build: 'BUILD-A' });
    const c = pull();
    expect(c.reasonCode).toBe('');
    c.pull();
    expect(c.pullConfirmation).toBe(false);
    c.confirmPull();
    expect(api['pullCutter']).not.toHaveBeenCalled();
  });
  it('sends the validated machine and run as pull preconditions', () => {
    setup({ build: 'BUILD-A' });
    const c = pull();
    c.reasonCode = 'TEARDOWN';
    c.pull();
    expect(api['pullCutter']).not.toHaveBeenCalled();
    expect(c.pullConfirmation).toBe(true);
    expect(c.pullConfirmationMessage).toContain('Machine M1');
    c.confirmPull();
    expect(api['pullCutter']).toHaveBeenCalledWith(
      expect.objectContaining({
        buildNumber: 'BUILD-A',
        expectedMachineNumber: 'M1',
        expectedMachineRunId: 'run-1',
      }),
    );
  });
  it('does not allow reset or another submission during a pending pull', () => {
    setup({ build: 'BUILD-A' });
    const c = pull();
    const pending = new Subject<never>();
    api['pullCutter'].mockReturnValue(pending);
    c.reasonCode = 'TEARDOWN';
    c.pull();
    c.confirmPull();
    c.reset();
    c.pull();
    c.confirmPull();
    expect(c.build?.build_number).toBe('BUILD-A');
    expect(api['pullCutter']).toHaveBeenCalledTimes(1);
  });
  it('invalidates a quality-check selection when its identifier is edited', () => {
    setup();
    const c = TestBed.runInInjectionContext(
      () => new GreenshedCheckComponent(),
    );
    c.build = build();
    c.contextValid = true;
    c.buildNumber = 'OTHER';
    c.onBuildInput();
    expect(c.build).toBeNull();
    expect(c.contextValid).toBe(false);
  });
  it('rejects invalid starting counts before invoking setup', () => {
    setup();
    const c = TestBed.runInInjectionContext(
      () => new GreenshedSetupComponent(),
    );
    c.build = { ...build(), status_code: 'READY' };
    c.machine = { machine_number: 'M1' } as never;
    c.part = { part_number: 'P1' } as never;
    c.startingPieceCount = 1.5;
    c.setup();
    expect(api['setupCutter']).not.toHaveBeenCalled();
    expect(c.error).toContain('whole');
  });
  it('rejects starting counts beyond the supported database range before invoking setup', () => {
    setup(); const c = TestBed.runInInjectionContext(() => new GreenshedSetupComponent());
    c.build = { ...build(), status_code: 'READY' }; c.machine = { machine_number: 'M1' } as never; c.part = { part_number: 'P1' } as never;
    c.startingPieceCount = 2147483648; c.setup();
    expect(api['setupCutter']).not.toHaveBeenCalled(); expect(c.error).toContain('2,147,483,647');
  });
  it('preserves setup failures inline and keeps the selected context for retry', () => {
    setup(); const c = TestBed.runInInjectionContext(() => new GreenshedSetupComponent());
    c.build = { ...build(), status_code: 'READY' }; c.machine = { machine_number: 'M1' } as never; c.part = { part_number: 'P1' } as never;
    api['setupCutter'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'The machine now has a cutter.' } })));
    c.setup(); expect(c.error).toBe('The machine now has a cutter.'); expect(c.busy).toBe(false);
    expect(c.build.build_number).toBe('BUILD-A'); expect(c.machine).toEqual({ machine_number: 'M1' }); expect(c.part).toEqual({ part_number: 'P1' });
  });
  it('clears previous cutter details immediately and leaves them cleared if a replacement lookup fails', () => {
    setup(); const c = TestBed.runInInjectionContext(() => new GreenshedLookupComponent());
    c.build = build(); const pending = new Subject<never>(); api['getBuild'].mockReturnValue(pending);
    c.open('MISSING'); expect(c.build).toBeNull(); expect(c.busy).toBe(true);
    pending.error(new HttpErrorResponse({ status: 404 }));
    expect(c.build).toBeNull(); expect(c.busy).toBe(false); expect(c.error).toBe('Build not found.');
  });
  it('distinguishes unavailable cutter history from an empty successful history response', () => {
    setup(); const c = TestBed.runInInjectionContext(() => new GreenshedLookupComponent());
    api['getHistory'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    c.open('BUILD-A'); expect(c.build?.build_number).toBe('BUILD-A'); expect(c.historyFailed).toBe(true);
    c.open('BUILD-A'); expect(c.historyFailed).toBe(false); expect(c.history).toEqual([]); expect(c.error).toBe('');
  });
  it('asks with the Dana dialog and does not pull when the selection changes before confirming', () => {
    setup({ build: 'BUILD-A' });
    const c = pull();
    c.reasonCode = 'TEARDOWN';
    c.pull();
    expect(c.pullConfirmation).toBe(true);
    c.buildNumber = 'OTHER';
    c.onBuildInput();
    expect(c.pullConfirmation).toBe(false);
    c.confirmPull();
    expect(api['pullCutter']).not.toHaveBeenCalled();
  });
  it('preserves machine/run preconditions in Running Machines pull navigation', () => {
    setup(); const c = TestBed.runInInjectionContext(() => new GreenshedMachinesComponent());
    const row = { build_number: 'BUILD-A', machine_number: 'M1', run_id: 'run-1' } as never;
    c.changeover(row);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/greenshed/pull'], { queryParams: { build: 'BUILD-A', reason: 'CHANGEOVER', machine: 'M1', run: 'run-1', origin: 'running-machines' } });
  });
  it('ignores a stale manual machine-board response after changing its filter', () => {
    setup(); const a = new Subject<never>(), b = new Subject<never>(); api['getRunningMachines'].mockReturnValueOnce(a).mockReturnValueOnce(b);
    const c = TestBed.runInInjectionContext(() => new GreenshedMachinesComponent()); c.refresh(); c.setActiveFilter('INACTIVE');
    a.next({ active_filter: 'ACTIVE', departments: [] } as never); expect(c.board).toBeNull(); expect(c.busy).toBe(true);
    b.next({ active_filter: 'INACTIVE', departments: [] } as never); expect(c.board?.active_filter).toBe('INACTIVE'); expect(c.busy).toBe(false);
  });
  it('never leaves Pull busy when a shelf answer is stale because the reason changed meanwhile', () => {
    setup({ build: 'BUILD-A', reason: 'CHANGEOVER' });
    const c = pull();
    const pending = new Subject<never>();
    api['scanLocation'].mockReturnValue(pending);
    c.shelfSerial = 'GSR-123';
    c.scanShelf();
    expect(c.busy).toBe(true);
    // Late reference data re-applies the requested reason as a new object.
    c.refs = { check_types: [], check_results: [], check_interval: 25, pull_reasons: reasons.map((reason) => ({ ...reason })) };
    pending.next({ serial_number: 'GSR-123' } as never);
    expect(c.busy).toBe(false);
    expect(c.shelf).toBeNull();
  });
  it('never leaves Setup busy when a machine or part answer is stale', () => {
    setup();
    const c = TestBed.runInInjectionContext(() => new GreenshedSetupComponent());
    const machine = new Subject<never>(), part = new Subject<never>();
    api['getMachine'].mockReturnValue(machine);
    api['getPartByNumber'].mockReturnValue(part);
    c.build = { ...build(), status_code: 'READY' };
    c.machineNumber = 'M1';
    c.scanMachine();
    expect(c.busy).toBe(true);
    c.build = { ...build('BUILD-B'), status_code: 'READY' };
    machine.next({ machine_number: 'M1', machine_active: true, active_run: null, department_code: '152' } as never);
    expect(c.busy).toBe(false);
    expect(c.machine).toBeNull();
    c.partNumber = 'P1';
    c.scanPart();
    c.build = { ...build('BUILD-C'), status_code: 'READY' };
    part.next({ part_number: 'P1', active: true } as never);
    expect(c.busy).toBe(false);
    expect(c.part).toBeNull();
  });
  it('does not let a superseded Setup answer clear the busy state of the newer request', () => {
    setup();
    const first = new Subject<GreenshedBuild>(), second = new Subject<GreenshedBuild>();
    api['getBuild'].mockReturnValueOnce(first).mockReturnValueOnce(second);
    const c = TestBed.runInInjectionContext(() => new GreenshedSetupComponent());
    c.buildNumber = 'BUILD-A'; c.scanBuild();
    query.next(convertToParamMap({}));
    c.buildNumber = 'BUILD-B'; c.scanBuild();
    first.next(build());
    expect(c.busy).toBe(true);
    second.next({ ...build('BUILD-B'), status_code: 'READY' });
    expect(c.busy).toBe(false);
    expect(c.build?.build_number).toBe('BUILD-B');
  });
  it('loads the Setup part list through the Greenshed API service', () => {
    setup();
    api['listParts'].mockReturnValue(of([
      { part_number: 'P2', active: true, enabled: true },
      { part_number: 'P1', active: true, enabled: true },
      { part_number: 'OFF', active: false, enabled: true },
    ]));
    const c = TestBed.runInInjectionContext(() => new GreenshedSetupComponent());
    expect(api['listParts']).toHaveBeenCalled();
    expect(c.availableParts.map((part) => part.part_number)).toEqual(['P1', 'P2']);
  });
});
