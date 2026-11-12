import { code128BSymbols } from '../barcodes';
import { code128Svg, fittedFontSize, locationLabelsHtml, openLocationLabels } from './location-label';

const LOCATION = {
  serial_number: 'GSR-1.955FC-RING',
  number: '14',
  summary: '1.955FC',
  part_type: 'RING',
  description: 'Green Shed rough shelf',
  department: 'GREENSHED',
};

describe('location label', () => {
  it('encodes Code 128 B with the check symbol worked out by hand', () => {
    // Start B 104, P 48, J 42, J 42, 1 17, 2 18, 3 19, C 35.
    // Check: (104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7) % 103 = 879 % 103 = 55.
    expect(code128BSymbols('PJJ123C')).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  });

  it('draws 11 modules per symbol plus a 13-module stop and both quiet zones', () => {
    const value = LOCATION.serial_number;
    const width = Number(/viewBox="0 0 (\d+) 1"/.exec(code128Svg(value))?.[1]);
    expect(width).toBe(11 * (value.length + 2) + 13 + 20);
  });

  it('refuses a value a barcode cannot carry', () => {
    expect(() => code128BSymbols('')).toThrow();
    expect(() => code128BSymbols('BINé')).toThrow();
  });

  it('prints the Summary, part type, location number and the location barcode on a landscape 4 x 6.5 page', () => {
    const html = locationLabelsHtml([LOCATION]);
    expect(html).toContain('@page{size:6.5in 4in;margin:0}');
    expect(html).toContain('>1.955FC</div>');
    expect(html).toContain('>RING</div>');
    expect(html).toContain('>14</div>');
    expect(html).toContain('aria-label="GSR-1.955FC-RING"');
    expect(html).toContain('<div class="serial">GSR-1.955FC-RING <span>· Green Shed rough shelf · GREENSHED</span></div>');
  });

  it('says what is not set rather than printing a blank', () => {
    const html = locationLabelsHtml([{ serial_number: 'BIN-01', number: 'BIN-01' }]);
    expect(html.match(/Not set/g)).toHaveLength(2);
    expect(html).toContain('<div class="serial">BIN-01</div>');
  });

  it('escapes what it prints', () => {
    const html = locationLabelsHtml([{ ...LOCATION, description: '<b>Rack & "A"</b>' }]);
    expect(html).toContain('&lt;b&gt;Rack &amp; &quot;A&quot;&lt;/b&gt;');
  });

  it('prints one page per location', () => {
    const html = locationLabelsHtml([LOCATION, { ...LOCATION, serial_number: 'GSR-2.100FC-PINION' }]);
    expect(html.match(/<section class="label">/g)).toHaveLength(2);
    expect(html).toContain('Print labels');
  });

  it('shrinks a long value to stay on one line in its column', () => {
    const column = 3.15 * 96;
    expect(fittedFontSize('RING', 56, column)).toBe(56);
    expect(fittedFontSize('PINION-SPECIAL-LONG', 56, column)).toBeLessThan(56);
    expect(fittedFontSize('PINION-SPECIAL-LONG', 56, column) * 0.64 * 19).toBeLessThanOrEqual(column);
  });

  it('opens the label and the print dialog', () => {
    const popup = {
      opener: {},
      document: { open: jest.fn(), write: jest.fn(), close: jest.fn(), getElementById: jest.fn().mockReturnValue(null) },
      focus: jest.fn(),
      print: jest.fn(),
    };
    const host = { open: jest.fn().mockReturnValue(popup) } as unknown as Window;
    expect(openLocationLabels([LOCATION], host)).toEqual({ ok: true });
    expect(popup.opener).toBeNull();
    expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining('GSR-1.955FC-RING'));
    expect(popup.print).toHaveBeenCalled();
  });

  it('asks for pop-ups when the browser blocks the window', () => {
    const host = { open: jest.fn().mockReturnValue(null) } as unknown as Window;
    expect(openLocationLabels([LOCATION], host)).toEqual({ ok: false, reason: expect.stringContaining('Allow pop-ups') });
  });
});
