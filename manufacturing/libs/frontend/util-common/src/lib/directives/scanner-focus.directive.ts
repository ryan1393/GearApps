import { DOCUMENT } from '@angular/common';
import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/** Prepare scanner entry without moving focus away from a control the user chose. */
@Directive({ selector: 'input[gearScannerFocus]', standalone: true })
export class GearScannerFocusDirective implements AfterViewInit {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  ngAfterViewInit(): void {
    if (this.document.activeElement === this.document.body) {
      this.input.nativeElement.focus({ preventScroll: true });
    }
  }
}
