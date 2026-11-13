import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { GreenshedApiService, GreenshedBuild } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { GreenshedCheckComponent } from './check/greenshed-check.component';
import { GreenshedPullComponent } from './pull/greenshed-pull.component';

const running = (number = 'BUILD-A'): GreenshedBuild => ({
  id: number, build_number: number, build_increment: 1, cutter_body_serial_number: 'BODY', summary_number: '123', summary_model: '',
  part_type_code: 'RING', status_code: 'RUNNING', built_at: '', shelf_location: null,
  machine_run: { id: 'run-1', machine_number: 'M1', part_number: 'P', current_piece_count: 10, last_check_piece_count: 0, next_check_piece_count: 25, installed_at: '' },
});
const reasons = [
  { id: 't', code: 'TEARDOWN', name: 'Teardown', description: '', requires_teardown: true, returns_to_shelf: false },
  { id: 'c', code: 'PCR_002', name: 'Changeover', description: '', requires_teardown: false, returns_to_shelf: true },
];

describe('Greenshed Pull and Quality Check as scan stations', () => {
  let api: Record<string, jest.Mock>;
  function configure<T>(component: new () => T, params: Record<string, string> = {}) {
    api = {
      getDashboard: jest.fn(() => of({ active_machines: [{ build_number: 'BUILD-A', machine_number: 'M1', summary_number: '123', part_type_code: 'RING', check_due: true }] })),
      getReferenceData: jest.fn(() => of({ pull_reasons: reasons, check_types: [{ code: 'FC', name: 'Frequency' }], check_results: [{ code: 'PASS', name: 'Pass' }], check_interval: 25 })),
      getBuild: jest.fn(() => of(running())),
      scanLocation: jest.fn(() => of({ serial_number: 'GSR-123', location_type: 'SHELF', department: 'GREENSHED', number: '123', description: null })),
      pullCutter: jest.fn(() => of({ status_code: 'SHELF', build_number: 'BUILD-A', shelf_location: 'GSR-123' })),
      qualityCheck: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        { provide: GreenshedApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(convertToParamMap(params)) } },
        { provide: GearToastService, useValue: { success: jest.fn(), warning: jest.fn(), error: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('Pull: scan or pick the cutter and shelf, with the blocked reason under Pull Cutter', () => {
    const fixture = configure(GreenshedPullComponent);
    const c = fixture.componentInstance;
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('gear-station-status')).toBeTruthy();
    expect(c.pullBlockedReason).toContain('active cutter first');
    expect(c.buildOptions[0].cells).toEqual(['BUILD-A', 'Machine M1', '123 RING']);
    c.useBuild('BUILD-A');
    expect(api['getBuild']).toHaveBeenCalledWith('BUILD-A');
    expect(c.pullBlockedReason).toContain('pull reason');
    c.reasonCode = 'PCR_002'; c.onReasonChange();
    expect(c.pullBlockedReason).toContain('GSR-123');
    expect(c.shelfOptions.map((option) => option.value)).toEqual(['GSR-123']);
    c.useShelf('GSR-123');
    expect(api['scanLocation']).toHaveBeenCalledWith('GSR-123');
    expect(c.pullBlockedReason).toBe('');
    c.pull();
    expect(api['pullCutter']).not.toHaveBeenCalled();
    c.confirmPull();
    expect(api['pullCutter']).toHaveBeenCalledWith(expect.objectContaining({ buildNumber: 'BUILD-A', shelfLocationSerial: 'GSR-123', expectedMachineRunId: 'run-1' }));
    expect(c.status).toEqual({ tone: 'success', text: 'Cutter returned intact to GSR-123.' });
    fixture.destroy();
  });

  it('Pull: an error shows in the status line, and Change on the cutter clears what followed', () => {
    const fixture = configure(GreenshedPullComponent);
    const c = fixture.componentInstance;
    api['getBuild'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    c.useBuild('MISSING');
    expect(c.status).toEqual({ tone: 'error', text: 'Build not found.' });
    c.useBuild('BUILD-A'); c.reasonCode = 'PCR_002'; c.onReasonChange(); c.useShelf('GSR-123');
    c.changeBuild();
    expect(c.build).toBeNull();
    expect(c.shelf).toBeNull();
    fixture.destroy();
  });

  it('Pull: a Running Machines selection stays locked', () => {
    const fixture = configure(GreenshedPullComponent, { origin: 'running-machines', build: 'BUILD-A', machine: 'M1', run: 'run-1' });
    const c = fixture.componentInstance;
    expect(c.build?.build_number).toBe('BUILD-A');
    c.changeBuild();
    c.useBuild('OTHER');
    expect(c.build?.build_number).toBe('BUILD-A');
    expect(api['getBuild']).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('Quality Check: scan or pick the cutter, then the reason Save is blocked is spelled out', () => {
    const fixture = configure(GreenshedCheckComponent);
    const c = fixture.componentInstance;
    expect(c.saveBlockedReason).toContain('active cutter first');
    expect(c.buildOptions[0].cells[3]).toBe('CHECK DUE');
    c.useBuild('BUILD-A');
    expect(c.contextValid).toBe(true);
    expect(c.saveBlockedReason).toBe('');
    expect(c.prompt).toContain('Enter never saves');
    c.changeBuild();
    expect(c.build).toBeNull();
    fixture.destroy();
  });
});
