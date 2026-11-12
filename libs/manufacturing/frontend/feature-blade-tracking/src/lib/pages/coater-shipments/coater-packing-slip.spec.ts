import { shipmentBarcode } from './coater-packing-slip';

describe('Coater shipment barcode', () => {
  it('draws Code 128 B with ten-module quiet zones, 48 units tall and 1.6 px per module', () => {
    const svg = shipmentBarcode('CS-1');
    // Start B, four characters, check and stop: 6 × 11 + 13 modules, plus 10 either side.
    expect(svg).toContain('viewBox="0 0 99 48" width="158.4" height="64"');
    expect(svg.match(/<rect /g)).toHaveLength(22);
    expect(svg).toContain('<g fill="#000"><rect x="10" y="0" width="2" height="48"/><rect x="13" y="0" width="1" height="48"/>');
    expect(svg).toContain('<rect x="87" y="0" width="2" height="48"/></g>');
    expect(svg).toContain('aria-label="CS-1"');
  });

  it('escapes the value in its label and title', () => {
    expect(shipmentBarcode('A<&>')).toContain('<title>A&lt;&amp;&gt;</title>');
  });

  it('refuses a shipment number it cannot encode', () => {
    for (const value of ['', 'CS-é', 'x'.repeat(81)]) {
      expect(() => shipmentBarcode(value)).toThrow('Shipment number cannot be encoded.');
    }
  });
});
