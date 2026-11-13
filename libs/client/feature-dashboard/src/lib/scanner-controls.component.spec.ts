import { TestBed } from '@angular/core/testing';
import { ScannerApi, ToastService } from '@meshforge/client/core';
import { Subject } from 'rxjs';
import { ScannerControlsComponent } from './scanner-controls.component';

describe('Scanner command feedback', () => {
  it('labels repeated controls by output and prevents overlapping commands', () => {
    const pending=new Subject<{data:string}>();
    const command=jest.fn(()=>pending);
    const toast={info:jest.fn(),error:jest.fn()};
    TestBed.configureTestingModule({imports:[ScannerControlsComponent],providers:[{provide:ScannerApi,useValue:{command}},{provide:ToastService,useValue:toast}]});
    const fixture=TestBed.createComponent(ScannerControlsComponent);
    fixture.componentRef.setInput('scannerId','scanner-a'); fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    const first=root.querySelector('button[aria-label="Output 1 On"]') as HTMLButtonElement;
    expect(root.querySelector('button[aria-label="Output 2 On"]')).not.toBeNull();
    first.click(); fixture.detectChanges();
    expect(command).toHaveBeenCalledWith('scanner-a','OUTON,1');
    expect(first.getAttribute('aria-busy')).toBe('true');
    expect([...root.querySelectorAll('button')].every(button=>button.disabled)).toBe(true);
    // A keyboard/programmatic repeat must also respect the in-flight guard.
    const component=fixture.componentInstance as unknown as {send(op:string):void};
    component.send('OUTOFF,1'); expect(command).toHaveBeenCalledTimes(1);
    pending.next({data:'OK'}); pending.complete(); fixture.detectChanges();
    expect(first.disabled).toBe(false);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('highlights each output as last set here, and goes compact inside a fitted card', () => {
    TestBed.configureTestingModule({imports:[ScannerControlsComponent],providers:[{provide:ScannerApi,useValue:{command:jest.fn()}},{provide:ToastService,useValue:{info:jest.fn(),error:jest.fn()}}]});
    const fixture=TestBed.createComponent(ScannerControlsComponent);
    fixture.componentRef.setInput('scannerId','scanner-a');
    fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    // No collector: nothing is highlighted.
    expect(root.querySelector('button[aria-pressed="true"]')).toBeNull();

    fixture.componentRef.setInput('io',{machine_id:'m1',worker:true,phase:'collecting',
      scanner_inputs:{'1':true,'2':false},scanner_outputs:{'1':true,'2':false},scanner_outputs_set_at:'2026-11-12T23:00:00.000Z'});
    fixture.detectChanges();
    expect(root.querySelector('button[aria-label="Output 1 On"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('button[aria-label="Output 1 Off"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('button[aria-label="Output 2 Off"]')?.className).toContain('gear-btn-primary');
    expect(root.textContent).toContain('the output state last set here');
    expect(root.classList).not.toContain('gear-ctl-compact');
    fixture.componentRef.setInput('compact',true);
    fixture.detectChanges();
    expect(root.classList).toContain('gear-ctl-compact');
  });

  it('splits into the outputs (with their state) and the other actions', () => {
    TestBed.configureTestingModule({imports:[ScannerControlsComponent],providers:[{provide:ScannerApi,useValue:{command:jest.fn()}},{provide:ToastService,useValue:{info:jest.fn(),error:jest.fn()}}]});
    const fixture=TestBed.createComponent(ScannerControlsComponent);
    fixture.componentRef.setInput('scannerId','scanner-a');
    fixture.componentRef.setInput('io',{machine_id:'m1',worker:true,phase:'collecting',scanner_outputs:{'1':true}});
    const root=fixture.nativeElement as HTMLElement;
    const groups=()=>[...root.querySelectorAll('[role="group"]')].map(g=>g.getAttribute('aria-label'));

    fixture.componentRef.setInput('part','outputs'); fixture.detectChanges();
    expect(groups()).toEqual(['Output 1','Output 2']);
    const rows=[...root.querySelectorAll('.gear-ctl-row')].map(r=>r.textContent?.replace(/\s+/g,' ').trim());
    expect(rows).toEqual(['Output 1*ON On Off','Output 2*— On Off']);
    expect(root.textContent).not.toContain('Highlighted:');

    fixture.componentRef.setInput('part','actions'); fixture.detectChanges();
    expect(groups()).toEqual(['Tuning','Test','Trigger']);
    expect(root.classList).toContain('gear-ctl-actions');
    expect(root.textContent).not.toContain('Highlighted:');
  });
});
