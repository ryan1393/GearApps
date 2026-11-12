import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { LocationLabelPrintResult } from '@meshforge/manufacturing/frontend/util-common';

import { AdminApiService, AdminLocationRow } from '../../admin-api.service';
import { AdminLocationsTabComponent } from './admin-locations-tab.component';

describe('AdminLocationsTabComponent', () => {
  let component: AdminLocationsTabComponent;
  let fixture: ComponentFixture<AdminLocationsTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLocationsTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const api = TestBed.inject(AdminApiService);
    jest.spyOn(api, 'listLocations').mockReturnValue(of({ data: [], meta: { hasNextPage: false } }));
    jest.spyOn(api, 'listPartSummaries').mockReturnValue(of({ data: [], meta: { hasNextPage: false } }));
    jest.spyOn(api, 'listPartTypes').mockReturnValue(of([]));
    fixture = TestBed.createComponent(AdminLocationsTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('location Summary and part type', () => {
    const fill = (serial: string) => {
      component.locationForm = { serial_number: serial, number: 'A-03', description: '', department: '', location_type: 'SHELF', enabled: true, summary_id: 'summary-1', part_type_id: 'ring' };
    };

    it('saves the chosen Summary and part type with the location', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createLocation').mockReturnValue(of({} as AdminLocationRow));
      fill('RACK-A-03');
      component.saveLocation();

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ serial_number: 'RACK-A-03', summary_id: 'summary-1', part_type_id: 'ring' }));
    });

    it('sends none for a Green Shed summary shelf, whose barcode sets them', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createLocation').mockReturnValue(of({} as AdminLocationRow));
      fill('GSR-1.955FC');
      expect(component.locationContentsFromBarcode).toBe(true);
      component.saveLocation();

      const payload = create.mock.calls[0][0];
      expect(payload).not.toHaveProperty('summary_id');
      expect(payload).not.toHaveProperty('part_type_id');
    });

    it('takes the part type from the R or P in a shelf barcode and sends only the Summary', () => {
      const create = jest.spyOn(TestBed.inject(AdminApiService), 'createLocation').mockReturnValue(of({} as AdminLocationRow));
      fill('cgdp-a1a');
      expect(component.locationContentsFromBarcode).toBe(false);
      expect(component.locationBarcodePartType).toBe('PINION');
      component.saveLocation();

      const payload = create.mock.calls[0][0];
      expect(payload).toMatchObject({ serial_number: 'CGDP-A1A', summary_id: 'summary-1' });
      expect(payload).not.toHaveProperty('part_type_id');

      fill('CGFR-B2C');
      expect(component.locationBarcodePartType).toBe('RING');
      fill('RACK-A-03');
      expect(component.locationBarcodePartType).toBeNull();
    });

    it('lists each Summary number once, without revisions', () => {
      const row = (id: string, number: string, revision: string, active = true, enabled = true) =>
        ({ id, number, revision, active, enabled, model_id: null, hos: null });
      component.partSummariesList.set([
        row('a-1', '1.955FC', '1'),
        row('a-2', '1.955FC', '2'),
        row('a-3', '1.955FC', '3', false),
        row('b-1', '1.500FC', 'A'),
        row('c-1', '2.000FC', 'A', true, false),
      ]);
      component.locationForm = { ...component.locationForm, summary_id: '' };
      expect(component.locationSummaryChoices.map((s) => s.id)).toEqual(['b-1', 'a-2']);

      component.locationForm = { ...component.locationForm, summary_id: 'a-1' };
      expect(component.locationSummaryChoices.map((s) => s.id)).toEqual(['b-1', 'a-1']);
    });

    it('reads the summary tag as Summary-PART TYPE, and only once both are set', () => {
      const location = { summary: { id: 's', number: '1.955fc' }, part_type: { id: 'r', code: 'RING' } } as AdminLocationRow;
      expect(component.locationSummaryTag(location)).toBe('1.955FC-RING');
      expect(component.locationSummaryTag({ ...location, part_type: null })).toBeNull();
    });
  });

  describe('4 x 6.5 location label', () => {
    const row = {
      id: 'loc-1', serial_number: 'GSR-1.955FC-RING', number: '14', description: 'Green Shed rough shelf', department: 'GREENSHED',
      enabled: true, summary: { number: '1.955FC' }, part_type: { code: 'RING' },
    } as unknown as AdminLocationRow;
    const result = (over: Partial<LocationLabelPrintResult>): LocationLabelPrintResult => ({
      record_id: 'loc-1', serial_number: 'GSR-1.955FC-RING', language: 'IPL', printed: true, printer_configured: true, printer_name: 'Card Printer',
      failure_reason: null, file_name: 'LOCATION-GSR-1.955FC-RING.prn', file_base64: '',
      label: { serial: 'GSR-1.955FC-RING', number: '14', summary: '1.955FC', partType: 'RING', description: 'Green Shed rough shelf', department: 'GREENSHED' },
      ...over,
    });
    const popup = () => ({ opener: {}, document: { open: jest.fn(), write: jest.fn(), close: jest.fn(), getElementById: jest.fn().mockReturnValue(null) }, focus: jest.fn(), print: jest.fn() });
    afterEach(() => jest.restoreAllMocks());

    it('sends the label to the card printer and says where', () => {
      const api = TestBed.inject(AdminApiService);
      const print = jest.spyOn(api, 'printLocationLabel').mockReturnValue(of(result({})));
      const success = jest.spyOn(component['toast'], 'success');
      component.cardPrintersLoaded({ label_type: 'CUTTER_CARD', printers: [], default_printer_name: 'Card Printer' });
      component.printLocationLabel(row);
      expect(print).toHaveBeenCalledWith('loc-1');
      expect(success).toHaveBeenCalledWith('Location label for GSR-1.955FC-RING sent to Card Printer.', 'Label printed');
      expect(component.labelFallback).toBeNull();
    });

    it('offers the browser print when the card printer does not take the label', () => {
      const api = TestBed.inject(AdminApiService);
      jest.spyOn(api, 'printLocationLabel').mockReturnValue(of(result({ printed: false, failure_reason: 'No answer from 10.0.0.9 within 5 seconds.' })));
      const open = jest.spyOn(window, 'open').mockReturnValue(popup() as unknown as Window);
      component.cardPrintersLoaded({ label_type: 'CUTTER_CARD', printers: [], default_printer_name: 'Card Printer' });
      component.printLocationLabel(row);
      expect(component.labelFallback?.reason).toBe('Card Printer did not print it: No answer from 10.0.0.9 within 5 seconds.');
      expect(open).not.toHaveBeenCalled();
      component.printFallbackInBrowser();
      expect(open).toHaveBeenCalledTimes(1);
      expect(component.labelFallback).toBeNull();
    });

    it('opens the browser print straight away when no card printer is set up', () => {
      const api = TestBed.inject(AdminApiService);
      const print = jest.spyOn(api, 'printLocationLabel');
      const fake = popup();
      jest.spyOn(window, 'open').mockReturnValue(fake as unknown as Window);
      component.cardPrintersLoaded({ label_type: 'CUTTER_CARD', printers: [], default_printer_name: null });
      component.printLocationLabel(row);
      expect(print).not.toHaveBeenCalled();
      expect(fake.document.write).toHaveBeenCalledWith(expect.stringContaining('@page{size:6.5in 4in;margin:0}'));
      expect(component.message).toContain('No 4×6.5 card printer is set up');
    });
  });
});
