import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MachinesApi } from '@meshforge/client/core';
import { Machine } from '@meshforge/shared/domain';
import { Subject } from 'rxjs';
import { CellLivePageComponent } from './cell-live-page.component';

describe('Live cell loading states', () => {
  it('distinguishes loading, failed loads and a successful empty cell, with a working retry', () => {
    const first = new Subject<Machine[]>(), retry = new Subject<Machine[]>();
    const list = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(retry);
    TestBed.configureTestingModule({ imports:[CellLivePageComponent], providers:[provideRouter([]),{provide:MachinesApi,useValue:{list}}] });
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
});
