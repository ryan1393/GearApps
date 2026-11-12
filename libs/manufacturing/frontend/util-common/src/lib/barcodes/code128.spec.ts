import {
  CODE128_PATTERNS,
  CODE128_QUIET_ZONE_MODULES,
  code128BLayout,
  code128BPatterns,
  code128BSymbols,
  isCode128BEncodable,
} from './code128';

const modules = (pattern: string): number => Array.from(pattern, Number).reduce((sum, width) => sum + width, 0);

describe('Code 128 subset B', () => {
  it('has a pattern for every symbol value, 11 modules each and 13 for stop', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((pattern) => expect(modules(pattern)).toBe(11));
    expect(modules(CODE128_PATTERNS[106])).toBe(13);
  });

  it('encodes start B, the characters, the weighted check symbol and stop', () => {
    expect(code128BSymbols('Wikipedia')).toEqual([104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, 106]);
    expect(code128BPatterns('A')).toEqual([
      CODE128_PATTERNS[104],
      CODE128_PATTERNS[33],
      CODE128_PATTERNS[(104 + 33) % 103],
      CODE128_PATTERNS[106],
    ]);
  });

  it('refuses values that are empty, longer than 80 or not printable ASCII by default', () => {
    expect(isCode128BEncodable('x'.repeat(80))).toBe(true);
    for (const value of ['', 'x'.repeat(81), 'café', 'tab\there']) {
      expect(isCode128BEncodable(value)).toBe(false);
      expect(() => code128BSymbols(value)).toThrow('cannot be encoded as a Code 128 barcode');
    }
  });

  it('can replace each unsupported UTF-16 code unit with ? and accept any length', () => {
    const lenient = { replaceUnsupported: true };
    expect(code128BSymbols('é', lenient)).toEqual(code128BSymbols('?'));
    expect(code128BSymbols('😀', lenient)).toEqual(code128BSymbols('??'));
    expect(code128BSymbols('', lenient)).toEqual([104, 1, 106]);
    expect(code128BSymbols('x'.repeat(120), lenient)).toHaveLength(123);
  });

  it('lays out whole-module bars between ten-module quiet zones', () => {
    const { bars, width } = code128BLayout('CS-1');
    const symbolModules = 11 * 6 + 13;
    expect(width).toBe(symbolModules + 2 * CODE128_QUIET_ZONE_MODULES);
    expect(bars).toHaveLength(3 * 6 + 4);
    expect(bars[0]).toEqual({ x: CODE128_QUIET_ZONE_MODULES, width: 2 });
    const last = bars[bars.length - 1];
    expect(last.x + last.width).toBe(width - CODE128_QUIET_ZONE_MODULES);
  });
});
