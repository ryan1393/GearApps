import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BladeTrackingApiService, InventoryLocationRow } from '@meshforge/manufacturing/frontend/data-access-blade-tracking';
import { GearToastService, LocationLabelPrintResult } from '@meshforge/manufacturing/frontend/util-common';
import { BladeLocationsComponent } from './blade-locations.component';

const location = {
  id: 'loc-1', serial_number: 'GSR-1.955FC-RING', number: '14', description: 'Rough shelf', department: 'GREENSHED',
  summary: { number: '1.955FC' }, part_type: { code: 'RING' },
} as unknown as InventoryLocationRow;

const result = (over: Partial<LocationLabelPrintResult> = {}): LocationLabelPrintResult => ({
  record_id: 'loc-1', serial_number: 'GSR-1.955FC-RING', language: 'ZPL', printed: true, printer_configured: true, printer_name: 'Zebra Cards',
  failure_reason: null, file_name: 'LOCATION-GSR-1.955FC-RING.zpl', file_base64: '',
  label: { serial: 'GSR-1.955FC-RING', number: '14', summary: '1.955FC', partType: 'RING', description: 'Rough shelf', department: 'GREENSHED' },
  ...over,
});

const popup = () => ({
  opener: {}, focus: jest.fn(), print: jest.fn(),
  document: { open: jest.fn(), write: jest.fn(), close: jest.fn(), getElementById: jest.fn().mockReturnValue(null) },
});

describe('Blade Tracking 4 x 6.5 location label', () => {
  let api: Record<string, jest.Mock>;
  let toast: Record<string, jest.Mock>;
  let component: BladeLocationsComponent;
  beforeEach(() => {
    api = { printLocationLabel: jest.fn(() => of(result())), getLocations: jest.fn(() => of({ data: [], total: 0 })) };
    toast = { success: jest.fn(), error: jest.fn() };
    TestBed.configureTestingModule({ providers: [
      { provide: BladeTrackingApiService, useValue: api },
      { provide: GearToastService, useValue: toast },
    ] });
    component = TestBed.runInInjectionContext(() => new BladeLocationsComponent());
    component.cardPrintersLoaded({ label_type: 'CUTTER_CARD', printers: [], default_printer_name: 'Zebra Cards' });
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends the label to the chosen card printer and says where', () => {
    component.printLocationLabel(location);
    expect(api['printLocationLabel']).toHaveBeenCalledWith('loc-1');
    expect(component.printMessage).toBe('Location label for GSR-1.955FC-RING sent to Zebra Cards.');
    expect(toast['success']).toHaveBeenCalled();
    expect(component.printingTagSerial).toBeNull();
  });

  it('offers the browser print with the printed values when the send fails', () => {
    api['printLocationLabel'].mockReturnValue(of(result({ printed: false, failure_reason: 'Connection refused.' })));
    const fake = popup();
    const open = jest.spyOn(window, 'open').mockReturnValue(fake as unknown as Window);
    component.printLocationLabel(location);
    expect(component.labelFallback?.reason).toBe('Zebra Cards did not print it: Connection refused.');
    expect(open).not.toHaveBeenCalled();
    component.printFallbackInBrowser();
    expect(fake.document.write).toHaveBeenCalledWith(expect.stringContaining('@page{size:6.5in 4in;margin:0}'));
    expect(component.labelFallback).toBeNull();
  });

  it('offers the browser print when the API refuses', () => {
    api['printLocationLabel'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Printer lookup failed.' } })));
    component.printLocationLabel(location);
    expect(component.labelFallback?.serial).toBe('GSR-1.955FC-RING');
    expect(component.labelFallback?.label.summary).toBe('1.955FC');
    expect(component.printingTagSerial).toBeNull();
  });

  it('prints from the browser straight away when no card printer is set up', () => {
    component.cardPrintersLoaded({ label_type: 'CUTTER_CARD', printers: [], default_printer_name: null });
    jest.spyOn(window, 'open').mockReturnValue(popup() as unknown as Window);
    component.printLocationLabel(location);
    expect(api['printLocationLabel']).not.toHaveBeenCalled();
    expect(component.printTone).toBe('info');
    expect(component.printMessage).toContain('No 4×6.5 card printer is set up');
  });
});
