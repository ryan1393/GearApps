import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FanucVariablesApi, LapperAccess, ScannerApi, ScannerDetailsApi } from '@meshforge/client/core';
import { Machine, MachineFanucVariable, ScannerDetail } from '@meshforge/shared/domain';
import { NEVER, Observable, of } from 'rxjs';
import { LIVE_FEED_MS, LIVE_REQUEST_TIMEOUT_MS, MachineLiveCardComponent } from './machine-live-card.component';

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
        { provide: ScannerApi, useValue: { image: jest.fn(), imageDefaults: () => of({ root: '181-lapper-scanners', imageFile: 'scanner-current.jpg' }) } },
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

  it('refreshes the image at once and every second while the photoeye is on, keeping the image shown', async () => {
    jest.useFakeTimers();
    const withScanner = { ...machine, scanner_id: 's1' } as unknown as Machine;
    const image = jest.fn(() => of(new Blob(['jpeg'], { type: 'image/jpeg' })));
    URL.createObjectURL = jest.fn(() => 'blob:capture');
    URL.revokeObjectURL = jest.fn();
    TestBed.configureTestingModule({
      imports: [MachineLiveCardComponent],
      providers: [
        { provide: LapperAccess, useValue: { canEditSetup: () => false } },
        { provide: ScannerApi, useValue: { image, imageDefaults: () => of({ root: '181-lapper-scanners', imageFile: 'scanner-current.jpg' }) } },
        { provide: ScannerDetailsApi, useValue: { get: jest.fn(() => of(null)) } },
        { provide: FanucVariablesApi, useValue: { byMachine: jest.fn(() => of(snapshot(false))) } },
      ],
    });
    TestBed.overrideComponent(MachineLiveCardComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(MachineLiveCardComponent);
    fixture.componentRef.setInput('machine', withScanner);
    fixture.componentRef.setInput('pollMs', 5000);
    fixture.detectChanges();
    await jest.advanceTimersByTimeAsync(0);
    expect(image).toHaveBeenCalledTimes(1);
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text()).not.toContain('Live · photoeye on');

    // The photoeye trips: refresh now, then every second instead of every 5 s.
    fixture.componentRef.setInput('photoeye', true);
    fixture.detectChanges();
    await jest.advanceTimersByTimeAsync(0);
    expect(image).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3 * LIVE_FEED_MS);
    expect(image).toHaveBeenCalledTimes(5);
    fixture.detectChanges();
    expect(text()).toContain('Live · photoeye on');
    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('blob:capture');

    // It clears: back to the chosen 5 s refresh.
    fixture.componentRef.setInput('photoeye', false);
    fixture.detectChanges();
    await jest.advanceTimersByTimeAsync(4000);
    expect(image).toHaveBeenCalledTimes(6);
    fixture.detectChanges();
    expect(text()).not.toContain('Live · photoeye on');
    fixture.destroy();
  });

  it('shows the FTP folder and file the image is read from, and whether it is the default', async () => {
    const scanner = { id: 's1', ip: '10.16.81.235', image_folder: null, image_file: null } as unknown as ScannerDetail;
    TestBed.configureTestingModule({
      imports: [MachineLiveCardComponent],
      providers: [
        { provide: LapperAccess, useValue: { canEditSetup: () => false } },
        { provide: ScannerApi, useValue: { image: jest.fn(() => NEVER), imageDefaults: () => of({ root: '181-lapper-scanners', imageFile: 'scanner-current.jpg' }) } },
        { provide: ScannerDetailsApi, useValue: { get: jest.fn(() => NEVER) } },
        { provide: FanucVariablesApi, useValue: { byMachine: jest.fn(() => NEVER) } },
      ],
    });
    TestBed.overrideComponent(MachineLiveCardComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(MachineLiveCardComponent);
    fixture.componentRef.setInput('machine', { ...machine, scanner_id: 's1', scanner } as unknown as Machine);
    fixture.detectChanges();
    const path = () => (fixture.nativeElement as HTMLElement).querySelector('.gear-live-path')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(path()).toBe('FTP 181-lapper-scanners/10.16.81.235/scanner-current.jpg (default)');

    fixture.componentRef.setInput('machine', {
      ...machine,
      scanner_id: 's1',
      scanner: { ...scanner, image_folder: '181-lapper-scanners/53711922' },
    } as unknown as Machine);
    fixture.detectChanges();
    expect(path()).toBe('FTP 181-lapper-scanners/53711922/scanner-current.jpg');
    fixture.destroy();
  });
});
