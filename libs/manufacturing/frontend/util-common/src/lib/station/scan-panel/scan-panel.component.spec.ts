import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { ScanPanelComponent } from './scan-panel.component';

/** Two steps like Receive Container: a tray, then the shelf it goes on. */
@Component({
  standalone: true,
  imports: [ScanPanelComponent],
  template: `
    <section class="op-page">
      <gear-scan-panel [step]="1" label="Tray" [busy]="busy" [doneValue]="tray" (scanned)="trays.push($event)" (heldScanIgnored)="ignored.push($event)" />
      @if (tray) {
        <gear-scan-panel [step]="2" label="Shelf" [busy]="busy" (scanned)="shelves.push($event)" />
      }
    </section>
  `,
})
class TwoStepHostComponent {
  busy = false;
  tray: string | null = null;
  trays: string[] = [];
  shelves: string[] = [];
  ignored: string[] = [];
}

describe('ScanPanelComponent while the station is busy', () => {
  let fixture: ComponentFixture<TwoStepHostComponent>;
  let host: TwoStepHostComponent;
  const rects = HTMLElement.prototype.getClientRects;

  beforeAll(() => {
    // jsdom has no layout; count every element as visible.
    HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  });
  afterAll(() => {
    HTMLElement.prototype.getClientRects = rects;
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(TwoStepHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  const input = (step: number) => fixture.nativeElement.querySelector(`input[data-gear-scan-step="${step}"]`) as HTMLInputElement;
  function scan(target: HTMLInputElement, text: string): void {
    for (const key of [...text, 'Enter']) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
  }

  it('keeps the box focusable but read-only and does not submit while busy', () => {
    host.busy = true;
    fixture.detectChanges();
    const box = input(1);
    expect(box.disabled).toBe(false);
    expect(box.readOnly).toBe(true);
    expect(box.getAttribute('aria-busy')).toBe('true');
    scan(box, 'T0001');
    expect(host.trays).toEqual([]);
  });

  it('submits on Enter when idle', () => {
    const box = input(1);
    box.value = 'T0001';
    box.dispatchEvent(new Event('input'));
    scan(box, '');
    expect(host.trays).toEqual(['T0001']);
  });

  it('holds a fast second scan and gives it to the step that opens when the first finishes', fakeAsync(() => {
    host.busy = true;
    fixture.detectChanges();
    scan(input(1), 'CGFR-A1A');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Scan CGFR-A1A is waiting');
    // The tray lookup finishes: step 1 is done and the shelf step opens.
    host.busy = false;
    host.tray = 'T0001';
    fixture.detectChanges();
    flush();
    expect(host.shelves).toEqual(['CGFR-A1A']);
    expect(host.trays).toEqual([]);
  }));

  it('keeps only the newest held scan', fakeAsync(() => {
    host.busy = true;
    fixture.detectChanges();
    scan(input(1), 'CGFR-A1A');
    scan(input(1), 'CGFR-B2B');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('replaces CGFR-A1A');
    host.busy = false;
    host.tray = 'T0001';
    fixture.detectChanges();
    flush();
    expect(host.shelves).toEqual(['CGFR-B2B']);
  }));

  it('does not guess when the previous step did not move on: the held scan is ignored and said so', fakeAsync(() => {
    host.busy = true;
    fixture.detectChanges();
    scan(input(1), 'CGFR-A1A');
    // The tray lookup failed: step 1 is still waiting for a tray.
    host.busy = false;
    fixture.detectChanges();
    flush();
    fixture.detectChanges();
    expect(host.trays).toEqual([]);
    expect(host.ignored).toEqual(['CGFR-A1A']);
    expect(fixture.nativeElement.textContent).toContain('Scan CGFR-A1A ignored — wait for the previous step');
  }));

  it('carries on a scan that was still arriving when the work finished', () => {
    host.busy = true;
    fixture.detectChanges();
    const box = input(1);
    for (const key of 'T00') box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    host.busy = false;
    fixture.detectChanges();
    const panel = fixture.debugElement.children[0].children[0].componentInstance as ScanPanelComponent;
    expect(panel.value).toBe('T00');
  });
});
