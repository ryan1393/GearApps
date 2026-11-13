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
});
