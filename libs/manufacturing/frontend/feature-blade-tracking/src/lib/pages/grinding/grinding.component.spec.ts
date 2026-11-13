import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BladeTrackingApiService } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { GrindingComponent } from './grinding.component';

describe('scan workstation', () => {
  let component: GrindingComponent;
  let history: Subject<unknown[]>;
  let start: Subject<unknown>;
  let api: { scanTray: jest.Mock; getTrayGrindingRuns: jest.Mock; startTrayGrinding: jest.Mock; getMachineGrindingRuns: jest.Mock; getWorkflowTrays: jest.Mock };
  beforeEach(() => {
    history = new Subject(); start = new Subject();
    api = {
      scanTray: jest.fn(() => of({ id:'tray',serial_number:'T0001',blades:[],blade_count:10,required_blade_count:10,current_stage:{code:'WAITING_FOR_GRINDING'},workflow_eligibility:{grinding:true} })),
      getTrayGrindingRuns: jest.fn(() => history), startTrayGrinding: jest.fn(() => start), getMachineGrindingRuns: jest.fn(() => of([])), getWorkflowTrays: jest.fn(() => of([])),
    };
    TestBed.configureTestingModule({providers:[
      {provide:BladeTrackingApiService,useValue:api},
      {provide:GearToastService,useValue:{error:jest.fn(),success:jest.fn()}},
    ]});
    component = TestBed.runInInjectionContext(() => new GrindingComponent());
    component.grinders = [{ id: "grinder-1", machine_number: "G01", department: "45" }];
    component.grinderId = "grinder-1";
  });
  afterEach(() => component.ngOnDestroy());
  it('requires a selected grinder and refuses a tray assigned to another grinder', () => {
    component.grinderId = ''; component.scanTray('T0001'); expect(api.scanTray).not.toHaveBeenCalled();
    component.grinderId = 'grinder-1'; component.scanTray('T0001');
    component.tray!.current_grinding_machine_id = 'grinder-2';
    expect(component.canRecordGrinding).toBe(false);
    component.recordGrinding(); expect(api.startTrayGrinding).not.toHaveBeenCalled();
  });
  it('makes the next action available without waiting for optional history', () => {
    component.scanTray('t0001');
    expect(api.scanTray).toHaveBeenCalledWith('T0001');
    expect(component.historyLoading).toBe(true);
    expect(component.canRecordGrinding).toBe(true);
    expect(api.startTrayGrinding).not.toHaveBeenCalled();
  });
  it('never clears an in-flight start when history arrives, and prevents duplicate starts', () => {
    component.scanTray('T0001'); component.recordGrinding();
    expect(component.busy).toBe(true);
    history.next([]);
    expect(component.busy).toBe(true);
    component.recordGrinding();
    expect(api.startTrayGrinding).toHaveBeenCalledTimes(1);
  });
  it('keeps a scan error on screen instead of only in a pop-up', () => {
    api.scanTray.mockReturnValueOnce(of({ id:'tray',serial_number:'T0002',blades:[],blade_count:10,current_stage:{code:'AT_COATER'},workflow_eligibility:{grinding:false} }));
    component.scanTray('T0002');
    expect(component.message?.tone).toBe('error');
    expect(component.message?.text).toContain('T0002 is not available for grinding');
    component.scanTray('T0001');
    expect(component.message).toBeNull();
  });
  it('explains an unknown grinder in operator terms', () => {
    component.scanGrinder('G99');
    expect(component.message).toEqual({ tone: 'error', text: 'No active grinder matches “G99”. Check the number, or ask a supervisor to add it.' });
  });
  it('keeps the scanned tray usable if optional history fails', () => {
    component.scanTray('T0001'); history.error(new Error('history unavailable'));
    expect(component.historyError).toBeTruthy();
    expect(component.canRecordGrinding).toBe(true);
  });
  it('opens a tray requested by another app once the grinder is known, without starting it', () => {
    component.grinderId = '';
    component.requestedTray = 't0001';
    expect(api.scanTray).not.toHaveBeenCalled();
    expect(component.prompt).toContain('Tray T0001 opens next');
    component.selectGrinder('grinder-1');
    expect(api.scanTray).toHaveBeenCalledWith('T0001');
    expect(component.waitingTraySerial).toBe('');
    expect(api.startTrayGrinding).not.toHaveBeenCalled();
    component.requestedTray = 'T0001';
    expect(api.scanTray).toHaveBeenCalledTimes(1);
  });
  it('does not let a double tap on Start Grinding also complete the pass', () => {
    jest.useFakeTimers();
    try {
      const completeTrayGrinding = jest.fn(() => of({}));
      (api as unknown as Record<string, jest.Mock>)['completeTrayGrinding'] = completeTrayGrinding;
      const blades = Array.from({ length: 10 }, (_, i) => ({ id: 'b' + i, serial_number: 'B' + i, status: 'grinding' }));
      component.scanTray('T0001');
      expect(component.primaryLabel).toBe('Start Grinding');
      api.scanTray.mockReturnValueOnce(of({ id: 'tray', serial_number: 'T0001', summary_id: 's', part_type_id: 'p', blades, blade_count: 10,
        required_blade_count: 12, current_stage: { code: 'GRINDING' }, workflow_eligibility: { grinding: true } }));
      component.recordGrinding();
      start.next({});
      // Same spot, now Complete Grinding: the second tap of a double tap lands here.
      expect(component.primaryLabel).toBe('Complete Grinding');
      expect(component.canRecordGrinding).toBe(false);
      expect(component.recordBlockedReason).toContain('Grinding just started');
      component.recordGrinding();
      expect(completeTrayGrinding).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1500);
      expect(component.canRecordGrinding).toBe(true);
      component.recordGrinding();
      expect(completeTrayGrinding).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
