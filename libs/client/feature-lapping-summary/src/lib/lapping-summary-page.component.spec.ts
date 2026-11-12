import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { FanucVariablesApi, GearsetsApi, Loadable, MachineCyclesApi, MachinesApi, MacroLogsApi } from '@meshforge/client/core';
import { CycleHistoryRow, LappingSummaryRow, MachineFanucVariable } from '@meshforge/shared/domain';
import { of, Subject, throwError } from 'rxjs';
import { LappingSummaryPageComponent } from './lapping-summary-page.component';

interface SummaryPage {
  machineId: WritableSignal<string|null>; gearsetId: WritableSignal<string|null>;
  tab: WritableSignal<string>; rows: Loadable<LappingSummaryRow[]>;
  selectCycle(cycle:CycleHistoryRow):void;
  reloadChoices():void;
}

describe('Lapping Summary evidence states', () => {
  function setup() {
    const first=new Subject<LappingSummaryRow[]>(), second=new Subject<LappingSummaryRow[]>();
    const summary=jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const live=new Subject<MachineFanucVariable|null>();
    const fanuc=jest.fn(()=>live);
    const machineList=jest.fn(()=>of([]));
    TestBed.configureTestingModule({imports:[LappingSummaryPageComponent],providers:[
      {provide:MachinesApi,useValue:{list:machineList,byGearset:()=>of([])}},
      {provide:GearsetsApi,useValue:{list:()=>of([]),byMachine:()=>of([])}},
      {provide:MachineCyclesApi,useValue:{historyPage:()=>of({items:[],total:0}),latest:()=>of(null)}},
      {provide:MacroLogsApi,useValue:{lappingSummary:summary,changes:()=>of([])}},
      {provide:FanucVariablesApi,useValue:{byMachine:fanuc}},
      {provide:ActivatedRoute,useValue:{queryParamMap:of(convertToParamMap({}))}},
    ]});
    const fixture=TestBed.createComponent(LappingSummaryPageComponent);
    const page=fixture.componentInstance as unknown as SummaryPage;
    fixture.detectChanges();
    page.machineId.set('machine-a'); page.gearsetId.set('gearset-a'); page.tab.set('summary');
    return {fixture,page,first,second,summary,live,fanuc,machineList};
  }
  it('clears the previous context and offers retry rather than claiming an empty recording after failure', () => {
    const {fixture,page,first,summary}=setup();
    page.rows.set([{id:'previous-machine'} as LappingSummaryRow]);
    fixture.detectChanges();
    expect(page.rows.value()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading values');
    first.error(new Error('Unavailable')); fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Could not load the recorded values');
    expect(root.textContent).not.toContain('No values recorded');
    const retry=[...root.querySelectorAll('button')].find(button=>button.textContent==='Retry values');
    retry?.click(); fixture.detectChanges();
    expect(summary).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('Loading values');
  });
  it('clears values immediately when selecting another cycle', () => {
    const {fixture,page,first,summary}=setup(); fixture.detectChanges();
    first.next([{id:'latest',number:1,name:'Old value',value:3,used_form:'general_data'} as LappingSummaryRow]);
    first.complete(); fixture.detectChanges();
    page.selectCycle({id:'cycle-b',consec:2,timestamp:'2026-11-12T00:00:00Z',serial_number:'B',cycle_time_s:null,changed_count:0} as CycleHistoryRow);
    expect(page.rows.value()).toEqual([]);
    expect(page.rows.loading()).toBe(true);
    expect(summary).toHaveBeenLastCalledWith('machine-a','gearset-a',undefined,undefined,'cycle-b');
    fixture.destroy();
  });
  it('lets a slow live controller response finish instead of canceling it every tick', () => {
    jest.useFakeTimers();
    const {fixture,fanuc,live}=setup();
    try {
      fixture.detectChanges();
      expect(fanuc).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(10_000); expect(fanuc).toHaveBeenCalledTimes(1);
      live.next(null); live.complete();
      jest.advanceTimersByTime(5000); expect(fanuc).toHaveBeenCalledTimes(2);
    } finally { fixture.destroy(); jest.useRealTimers(); }
  });
  it('recovers failed selection choices without an unhandled route-subscription error', () => {
    const {fixture,page,machineList}=setup();
    machineList.mockReturnValueOnce(throwError(()=>new Error('Offline')));
    page.reloadChoices(); fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Could not load machine and gearset choices');
    [...root.querySelectorAll('button')].find(button=>button.textContent==='Retry choices')?.click();
    fixture.detectChanges();
    expect(machineList).toHaveBeenCalledTimes(3);
    expect(root.textContent).not.toContain('Could not load machine and gearset choices');
    fixture.destroy();
  });
});
