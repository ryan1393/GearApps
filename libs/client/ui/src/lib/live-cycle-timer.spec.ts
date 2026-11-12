import { TestBed } from '@angular/core/testing';
import { formatAge, formatRunningTime, liveCycleState, MachineFanucVariable } from '@meshforge/shared/domain';
import { LiveCycleTimerComponent } from './live-cycle-timer.component';

const snapshot = (over: Partial<MachineFanucVariable> = {}): MachineFanucVariable => ({
  id: 'v1', machine_id: 'm1', x06_7_frt_dr_closed: true, x01_2_start_cycle: false,
  y03_2_stack_inCycle: true, cycle_elapsed_s: 83.5, reported_age_s: 4, ...over,
});

describe('liveCycleState', () => {
  const at = 1_000_000;

  it('counts up from the server-reported elapsed time by the time since it was received', () => {
    expect(liveCycleState(snapshot(), at, at)).toEqual({ kind: 'running', seconds: 83.5 });
    expect(liveCycleState(snapshot(), at, at + 10_000)).toEqual({ kind: 'running', seconds: 93.5 });
  });

  it('shows idle out of cycle, and unknown when the start was not seen', () => {
    expect(liveCycleState(snapshot({ y03_2_stack_inCycle: false, cycle_elapsed_s: null }), at, at)).toEqual({ kind: 'idle' });
    expect(liveCycleState(snapshot({ cycle_elapsed_s: null }), at, at)).toEqual({ kind: 'running-unknown' });
  });

  it('goes stale when the collector stops reporting, instead of running on', () => {
    expect(liveCycleState(snapshot({ reported_age_s: 85 }), at, at).kind).toBe('running');
    expect(liveCycleState(snapshot({ reported_age_s: 85 }), at, at + 6_000)).toEqual({ kind: 'stale', ageSeconds: 91 });
  });

  it('never calls an older collector, which reports no age, stale', () => {
    expect(liveCycleState(snapshot({ reported_age_s: null }), at, at + 3_600_000).kind).toBe('running');
  });

  it('has nothing to show without a snapshot', () => {
    expect(liveCycleState(null, at, at)).toEqual({ kind: 'none' });
  });
});

describe('running time and age text', () => {
  it('formats whole seconds, with hours past an hour', () => {
    expect(formatRunningTime(0)).toBe('0:00');
    expect(formatRunningTime(83.9)).toBe('1:23');
    expect(formatRunningTime(3723)).toBe('1:02:03');
  });

  it('formats how long a snapshot has been stale', () => {
    expect(formatAge(91)).toBe('1 min');
    expect(formatAge(330)).toBe('5 min');
    expect(formatAge(3900)).toBe('1 h 5 min');
  });
});

describe('LiveCycleTimerComponent', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('ticks every second while the machine is in cycle', () => {
    const fixture = TestBed.createComponent(LiveCycleTimerComponent);
    fixture.componentRef.setInput('snapshot', snapshot({ cycle_elapsed_s: 60 }));
    fixture.componentRef.setInput('receivedAt', Date.now());
    fixture.detectChanges();
    const text = () => (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim();
    expect(text()).toBe('In cycle 1:00');
    jest.advanceTimersByTime(5_000);
    fixture.detectChanges();
    expect(text()).toBe('In cycle 1:05');
  });
});
