import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { DanaPageHeaderComponent } from '@dana/ui';
import { EmptyStateComponent } from '@meshforge/client/ui';
import { CollectorApi, CollectorStatus, MachinesApi } from '@meshforge/client/core';
import { Machine } from '@meshforge/shared/domain';
import { of, Subject, throwError } from 'rxjs';
import { CellLivePageComponent, PHOTOEYE_POLL_MS } from './cell-live-page.component';

describe('Live cell loading states', () => {
  it('distinguishes loading, failed loads and a successful empty cell, with a working retry', () => {
    const first = new Subject<Machine[]>(), retry = new Subject<Machine[]>();
    const list = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(retry);
    TestBed.configureTestingModule({ imports:[CellLivePageComponent], providers:[provideRouter([]),{provide:MachinesApi,useValue:{list}},{provide:CollectorApi,useValue:{status:()=>of({last_discovery:null,machines:[]})}}] });
    const fixture = TestBed.createComponent(CellLivePageComponent);
    fixture.componentRef.setInput('cell','1');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role=status]')?.textContent).toContain('Loading machines');
    expect(root.textContent).not.toContain('No machines in cell');
    first.error(new HttpErrorResponse({status:503,error:{message:'Machine service unavailable'}}));
    fixture.detectChanges();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Machine service unavailable');
    expect(root.textContent).not.toContain('No machines in cell');
    const button = [...root.querySelectorAll('button')].find(value=>value.textContent?.includes('Retry loading'));
    button?.click(); fixture.detectChanges();
    expect(list).toHaveBeenCalledTimes(2);
    retry.next([]); retry.complete(); fixture.detectChanges();
    expect(root.querySelector('[role=alert]')).toBeNull();
    expect(root.textContent).toContain('No machines in cell 1');
  });

  it('asks Lapper Read which photoeyes are on and keeps working without it', async () => {
    jest.useFakeTimers();
    const replies: Array<CollectorStatus | Error> = [
      { last_discovery: null, machines: [
        { machine_id: 'm1', worker: true, phase: 'collecting', photoeye: true },
        { machine_id: 'm2', worker: true, phase: 'collecting', photoeye: false },
      ] },
      new Error('collector not running'),
    ];
    const status = jest.fn(() => {
      const next = replies.shift() ?? new Error('collector not running');
      return next instanceof Error ? throwError(() => next) : of(next);
    });
    TestBed.configureTestingModule({ imports:[CellLivePageComponent], providers:[provideRouter([]),{provide:MachinesApi,useValue:{list:()=>of([])}},{provide:CollectorApi,useValue:{status}}] });
    const fixture = TestBed.createComponent(CellLivePageComponent);
    fixture.componentRef.setInput('cell','1');
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { photoeyes(): ReadonlySet<string> };
    expect([...page.photoeyes()]).toEqual(['m1']);
    await jest.advanceTimersByTimeAsync(PHOTOEYE_POLL_MS);
    expect(status).toHaveBeenCalledTimes(2);
    expect([...page.photoeyes()]).toEqual([]);
    fixture.destroy();
    jest.useRealTimers();
  });

  it('shows one machine on its own when focused, with a way back to the cell', () => {
    const machines = [
      { id: 'm1', number: '01-094-292', ip: '10.16.81.212', cell: '1', status: 'Active' },
      { id: 'm2', number: '01-094-305', ip: '10.16.81.213', cell: '1', status: 'Active' },
    ] as unknown as Machine[];
    TestBed.configureTestingModule({ imports:[CellLivePageComponent], providers:[provideRouter([]),{provide:MachinesApi,useValue:{list:()=>of(machines)}},{provide:CollectorApi,useValue:{status:()=>of({last_discovery:null,machines:[]})}}] });
    TestBed.overrideComponent(CellLivePageComponent, { set: { imports: [RouterLink, DanaPageHeaderComponent, EmptyStateComponent], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(CellLivePageComponent);
    fixture.componentRef.setInput('cell','1');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const cards = () => root.querySelectorAll('gear-machine-live-card').length;
    expect(cards()).toBe(2);
    expect(root.textContent).toContain('All cells');

    fixture.componentRef.setInput('machine','m2');
    fixture.detectChanges();
    expect(cards()).toBe(1);
    expect(root.querySelector('h1')?.textContent).toContain('01-094-305');
    expect(root.textContent).toContain('Back to cell 1');

    // An id from another cell (an old bookmark) shows the whole cell.
    fixture.componentRef.setInput('machine','other');
    fixture.detectChanges();
    expect(cards()).toBe(2);

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (fixture.componentInstance as unknown as { focusOn(id: string): void }).focusOn('m1');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { machine: 'm1' }, queryParamsHandling: 'merge' }));
  });

  it('fills the screen below the header when it fits, and scrolls as usual when it does not', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, number: '01-094-' + i, ip: '10.0.0.' + i, cell: '1', status: 'Active' })) as unknown as Machine[];
    let machines = many(2);
    TestBed.configureTestingModule({ imports:[CellLivePageComponent], providers:[provideRouter([]),{provide:MachinesApi,useValue:{list:()=>of(machines)}},{provide:CollectorApi,useValue:{status:()=>of({last_discovery:null,machines:[]})}}] });
    TestBed.overrideComponent(CellLivePageComponent, { set: { imports: [RouterLink, EmptyStateComponent], schemas: [NO_ERRORS_SCHEMA] } });
    const size = (width: number, height: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    };
    size(1920, 1080);
    const fixture = TestBed.createComponent(CellLivePageComponent);
    fixture.componentRef.setInput('cell','1');
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      fit(): void; fitHeight(): number | null; layout(): { cols: number; rows: number }; recentCount(): number; reload(): void;
    };
    const grid = () => (fixture.nativeElement as HTMLElement).querySelector('.gear-live-grid') as HTMLElement;
    page.fit();
    fixture.detectChanges();
    expect(page.fitHeight()).toBe(1080 - 16);
    expect(grid().style.height).toBe('1064px');
    expect(grid().style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(page.recentCount()).toBe(5);

    // A short window: rows would be too small to show everything, so the page scrolls instead.
    size(1366, 500);
    page.fit();
    expect(page.fitHeight()).toBeNull();

    // Narrow screens and cells of more than four machines scroll too.
    size(900, 1080);
    page.fit();
    expect(page.fitHeight()).toBeNull();
    size(1920, 1080);
    machines = many(5);
    page.reload();
    fixture.detectChanges();
    page.fit();
    expect(page.fitHeight()).toBeNull();
    // Four machines: two rows of two. At 1080 px each row would be too short (scrolls, 5 cycles);
    // at 1200 px they fit, with 3 cycles each.
    machines = many(4);
    page.reload();
    fixture.detectChanges();
    page.fit();
    expect(page.layout()).toEqual({ cols: 2, rows: 2 });
    expect(page.fitHeight()).toBeNull();
    expect(page.recentCount()).toBe(5);
    size(1920, 1200);
    page.fit();
    expect(page.fitHeight()).toBe(1200 - 16);
    expect(page.recentCount()).toBe(3);
    fixture.destroy();
  });
});
