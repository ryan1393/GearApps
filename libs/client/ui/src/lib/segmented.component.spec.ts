import { TestBed } from '@angular/core/testing';
import { SegmentedComponent } from './segmented.component';

describe('Segmented choice keyboard access', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [SegmentedComponent] });
    const fixture = TestBed.createComponent(SegmentedComponent);
    fixture.componentRef.setInput('options', [{label:'First',value:'a'},{label:'Second',value:'b'},{label:'Third',value:'c'}]);
    fixture.componentRef.setInput('ariaLabel', 'View');
    const change = jest.fn();
    fixture.componentInstance.registerOnChange(change);
    fixture.detectChanges();
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
    return { fixture, change, buttons };
  }
  it('has one tab stop, selects with arrows and wraps at either end', () => {
    const { fixture, change, buttons } = render();
    expect(buttons.map(button=>button.tabIndex)).toEqual([0,-1,-1]);
    buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    fixture.detectChanges();
    expect(change).toHaveBeenLastCalledWith('b');
    expect(buttons.map(button=>button.tabIndex)).toEqual([-1,0,-1]);
    expect(buttons[1].getAttribute('aria-checked')).toBe('true');
    buttons[1].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    buttons[2].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    expect(change).toHaveBeenLastCalledWith('a');
    buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    expect(change).toHaveBeenLastCalledWith('c');
  });
  it('does not change a disabled choice with keyboard events', () => {
    const { fixture, change, buttons } = render();
    fixture.componentInstance.setDisabledState(true);
    fixture.detectChanges();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    expect(change).not.toHaveBeenCalled();
    expect(buttons.every(button=>button.disabled)).toBe(true);
  });
});
