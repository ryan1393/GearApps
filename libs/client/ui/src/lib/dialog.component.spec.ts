import { TestBed } from '@angular/core/testing';
import { DialogComponent } from './dialog.component';

describe('Dialog save protection', () => {
  it('keeps an in-flight save open on Escape or backdrop, then permits dismissal', () => {
    TestBed.configureTestingModule({imports:[DialogComponent]});
    const fixture=TestBed.createComponent(DialogComponent);
    fixture.componentRef.setInput('title','Edit scanner');
    fixture.componentRef.setInput('dismissible',false);
    fixture.detectChanges();
    const dialog=(fixture.nativeElement as HTMLElement).querySelector('dialog') as HTMLDialogElement;
    // jsdom lacks the native modal methods; open is otherwise a real reflected attribute.
    dialog.showModal=()=>dialog.setAttribute('open','');
    dialog.close=()=>dialog.removeAttribute('open');
    fixture.componentInstance.open.set(true); fixture.detectChanges();
    const escape=new Event('cancel',{cancelable:true}); dialog.dispatchEvent(escape);
    dialog.dispatchEvent(new MouseEvent('mousedown',{clientX:-1,clientY:-1,bubbles:true}));
    expect(escape.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.open()).toBe(true);
    fixture.componentRef.setInput('dismissible',true); fixture.detectChanges();
    dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
