import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FanucVariablesApi, LapperAccess, ScannerApi, ScannerDetailsApi } from '@meshforge/client/core';
import { Machine, MachineFanucVariable } from '@meshforge/shared/domain';
import { NEVER, Observable, of } from 'rxjs';
import { LIVE_REQUEST_TIMEOUT_MS, MachineLiveCardComponent } from './machine-live-card.component';

describe('Live machine card polling', () => {
  const machine = { id: 'm1', number: '01-094-101', ip: '10.0.0.1', status: 'active', scanner_id: null, scanner: null } as unknown as Machine;
  const snapshot = (inCycle: boolean) =>
    ({ id: 'v1', machine_id: 'm1', x06_7_frt_dr_closed: true, x01_2_start_cycle: false, y03_2_stack_inCycle: inCycle }) as MachineFanucVariable;

  afterEach(() => jest.useRealTimers());

  it('gives up on a hung request, shows the card as not refreshed and keeps polling', async () => {
    jest.useFakeTimers();
    const replies: Array<Observable<MachineFanucVariable>> = [of(snapshot(true)), NEVER, of(snapshot(false))];
    const byMachine = jest.fn(() => replies.shift() ?? of(snapshot(false)));
    TestBed.configureTestingModule({
      imports: [MachineLiveCardComponent],
      providers: [
        { provide: LapperAccess, useValue: { canEditSetup: () => false } },
        { provide: ScannerApi, useValue: { image: jest.fn() } },
        { provide: ScannerDetailsApi, useValue: { get: jest.fn() } },
        { provide: FanucVariablesApi, useValue: { byMachine } },
      ],
    });
    TestBed.overrideComponent(MachineLiveCardComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(MachineLiveCardComponent);
    fixture.componentRef.setInput('machine', machine);
    fixture.componentRef.setInput('pollMs', 5000);
    fixture.detectChanges();
    await jest.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const card = fixture.componentInstance as unknown as { fanuc(): MachineFanucVariable | null; fanucStale(): boolean };
    expect(card.fanuc()?.y03_2_stack_inCycle).toBe(true);

    // The second poll hangs: without a timeout every later poll would wait on it for ever.
    await jest.advanceTimersByTimeAsync(5000);
    expect(byMachine).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS);
    fixture.detectChanges();
    expect(card.fanucStale()).toBe(true);
    expect(card.fanuc()?.y03_2_stack_inCycle).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Machine I/O did not refresh');

    // The tick during the hung request was skipped; the next one polls again.
    await jest.advanceTimersByTimeAsync(10_000 - LIVE_REQUEST_TIMEOUT_MS);
    fixture.detectChanges();
    expect(byMachine).toHaveBeenCalledTimes(3);
    expect(card.fanucStale()).toBe(false);
    expect(card.fanuc()?.y03_2_stack_inCycle).toBe(false);
    fixture.destroy();
  });
});
