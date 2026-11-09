import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GearScannerFocusDirective } from './scanner-focus.directive';

@Component({ imports: [GearScannerFocusDirective], template: '<input gearScannerFocus aria-label="Scan" />' })
class ScannerHostComponent {}

describe('GearScannerFocusDirective', () => {
  afterEach(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

  it('prepares the scan field when no other control has focus', () => {
    const fixture = TestBed.createComponent(ScannerHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('input'));
    fixture.destroy();
  });

  it('keeps focus on a control the user already chose', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    const fixture = TestBed.createComponent(ScannerHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    expect(document.activeElement).toBe(button);
    fixture.destroy();
    button.remove();
  });
});
