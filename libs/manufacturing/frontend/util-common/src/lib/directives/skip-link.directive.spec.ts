import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GearSkipLinkDirective } from './skip-link.directive';

@Component({imports:[GearSkipLinkDirective],template:'<a gearSkipLink="review-main" href="#review-main">Skip</a><main id="review-main" tabindex="-1">Page</main>'})
class SkipHost {}

describe('Skip to content',()=>{
  it.each(['review-main',''])('focuses and scrolls target %s without fragment navigation',targetId=>{
    TestBed.overrideTemplate(SkipHost,`<a gearSkipLink="${targetId}" href="#${targetId || 'main-content'}">Skip</a><main id="${targetId || 'main-content'}" tabindex="-1">Page</main>`);
    const fixture=TestBed.createComponent(SkipHost);
    document.body.appendChild(fixture.nativeElement);fixture.detectChanges();
    const target=fixture.nativeElement.querySelector('main') as HTMLElement;
    target.scrollIntoView=jest.fn();
    const event=new MouseEvent('click',{bubbles:true,cancelable:true,button:0});
    fixture.nativeElement.querySelector('a').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(target.scrollIntoView).toHaveBeenCalledWith({block:'start'});
    fixture.destroy();fixture.nativeElement.remove();
  });

  it('leaves modified clicks and missing targets to the native link',()=>{
    const skip=TestBed.runInInjectionContext(()=>new GearSkipLinkDirective());
    const target=document.createElement('main');
    target.id='modified-target';target.tabIndex=-1;target.scrollIntoView=jest.fn();document.body.appendChild(target);
    skip.gearSkipLink=target.id;
    for(const options of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]) {
      const event=new MouseEvent('click',{cancelable:true,...options});
      skip.skip(event);expect(event.defaultPrevented).toBe(false);
    }
    expect(target.scrollIntoView).not.toHaveBeenCalled();target.remove();
    skip.gearSkipLink='missing-target';
    const event=new MouseEvent('click',{cancelable:true});skip.skip(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
