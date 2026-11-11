import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BladeTrackingApiService } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService } from '@meshforge/manufacturing/frontend/util-common';
import { GrindingComponent } from './grinding.component';

describe('scan workstation', () => {
  let component: GrindingComponent;
  let history: Subject<unknown[]>;
  let start: Subject<unknown>;
  let api: { scanTray: jest.Mock; getTrayGrindingRuns: jest.Mock; startTrayGrinding: jest.Mock };
  beforeEach(() => {
    history = new Subject(); start = new Subject();
    api = {
      scanTray: jest.fn(() => of({ id:'tray',serial_number:'T0001',blades:[],blade_count:10,required_blade_count:10,current_stage:{code:'WAITING_FOR_GRINDING'},workflow_eligibility:{grinding:true} })),
      getTrayGrindingRuns: jest.fn(() => history), startTrayGrinding: jest.fn(() => start),
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
  it('keeps the scanned tray usable if optional history fails', () => {
    component.scanTray('T0001'); history.error(new Error('history unavailable'));
    expect(component.historyError).toBeTruthy();
    expect(component.canRecordGrinding).toBe(true);
  });
});
