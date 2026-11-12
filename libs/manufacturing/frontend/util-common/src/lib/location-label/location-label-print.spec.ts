import { LocationLabelPrintResult, locationLabelFallbackReason, locationLabelFromResult } from './location-label-print';

const result = (over: Partial<LocationLabelPrintResult> = {}): LocationLabelPrintResult => ({
  record_id: 'loc-1', serial_number: 'GSR-1.955FC-RING', language: 'IPL', printed: false, printer_configured: true, printer_name: 'Card Printer',
  failure_reason: 'No answer from 10.0.0.9 within 5 seconds.', file_name: 'LOCATION-GSR-1.955FC-RING.prn', file_base64: '',
  label: { serial: 'GSR-1.955FC-RING', number: '14', summary: '1.955FC', partType: 'RING', description: 'Rough shelf', department: 'GREENSHED' },
  ...over,
});

describe('location label print result', () => {
  it('turns the printed values into the browser label', () => {
    expect(locationLabelFromResult(result())).toEqual({
      serial_number: 'GSR-1.955FC-RING', number: '14', summary: '1.955FC', part_type: 'RING', description: 'Rough shelf', department: 'GREENSHED',
    });
  });

  it('says why the card printer did not print it', () => {
    expect(locationLabelFallbackReason(result())).toBe('Card Printer did not print it: No answer from 10.0.0.9 within 5 seconds.');
    expect(locationLabelFallbackReason(result({ printer_configured: false, printer_name: null }))).toBe('No 4×6.5 card printer is set up.');
    expect(locationLabelFallbackReason(result({ printer_name: null, failure_reason: null }))).toBe('The card printer did not print it: no answer.');
  });
});
