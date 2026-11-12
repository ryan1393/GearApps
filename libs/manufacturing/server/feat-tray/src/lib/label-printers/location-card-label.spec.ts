import {
  LOCATION_LABEL_HEIGHT,
  LOCATION_LABEL_LENGTH,
  buildLocationCardIpl,
  buildLocationCardZpl,
  locationCardFileName,
  locationCardLayout,
  textWidth,
} from './location-card-label';

const SAMPLE = {
  serial: 'GSR-1.955FC-RING',
  number: '14',
  summary: '1.955FC',
  partType: 'RING',
  description: 'Green Shed rough shelf',
  department: 'GREENSHED',
};
const ZPL = { clean: (v: string | null | undefined, m: number) => String(v ?? '').slice(0, m), characterWidth: 0.6 };
const IPL = { clean: (v: string | null | undefined, m: number) => String(v ?? '').slice(0, m), characterWidth: 0.75 };

describe('4 x 6.5 location label', () => {
  it('keeps every element inside the landscape label, whatever the values', () => {
    for (const language of [IPL, ZPL]) {
      for (const fields of [
        SAMPLE,
        { serial: 'CGDR-2.100FC-GEARSET-07-LONGER-SERIAL', number: 'A-12-LONG', summary: 'MWMWMWMWMWMWMW', partType: 'GEARSET-LONG', description: 'x'.repeat(60), department: 'CUTTER GRIND' },
        { serial: 'X1' },
      ]) {
        for (const e of locationCardLayout(fields, language)) {
          const width =
            e.kind === 'text' ? textWidth(language, e.value, e.height)
            : e.kind === 'barcode' ? (11 * (e.value.length + 2) + 13) * e.moduleDots
            : e.width;
          const height = e.kind === 'bar' ? e.height : e.height;
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.y).toBeGreaterThanOrEqual(0);
          expect(e.x + width).toBeLessThanOrEqual(LOCATION_LABEL_LENGTH);
          expect(e.y + height).toBeLessThanOrEqual(LOCATION_LABEL_HEIGHT);
        }
      }
    }
  });

  it('keeps part type and location number inside their own columns', () => {
    const layout = locationCardLayout({ ...SAMPLE, partType: 'GEARSET', number: 'WM-0007' }, ZPL);
    const divider = layout.find((e) => e.kind === 'bar' && e.height > 100);
    const part = layout.find((e) => e.kind === 'text' && e.value === 'GEARSET');
    const number = layout.find((e) => e.kind === 'text' && e.value === 'WM-0007');
    if (!divider || !part || !number || part.kind !== 'text' || number.kind !== 'text') throw new Error('missing elements');
    expect(part.x + textWidth(ZPL, part.value, part.height)).toBeLessThan(divider.x);
    expect(number.x).toBeGreaterThan(divider.x);
  });

  it('prints Not set rather than a blank, and the serial as the location number when none is set', () => {
    const texts = locationCardLayout({ serial: 'bin-01' }, IPL).filter((e) => e.kind === 'text').map((e) => (e as { value: string }).value);
    expect(texts.filter((t) => t === 'NOT SET')).toHaveLength(2);
    expect(texts).toContain('BIN-01');
  });

  it('writes IPL fields that read along the feed (direction 0) inside the printed area of the card', () => {
    const ipl = buildLocationCardIpl(SAMPLE).toString('latin1');
    expect(ipl).toContain('d3,1.955FC;');
    expect(ipl).toContain(',LocBar;');
    const origins = [...ipl.matchAll(/;o(\d+),(\d+);f(\d);/g)];
    expect(origins.length).toBeGreaterThan(8);
    for (const [, feed, across, direction] of origins) {
      expect(direction).toBe('0');
      expect(Number(feed)).toBeGreaterThanOrEqual(25);
      expect(Number(feed)).toBeLessThanOrEqual(1265);
      expect(Number(across)).toBeGreaterThanOrEqual(52);
      expect(Number(across)).toBeLessThanOrEqual(864);
    }
    // The same card setup as the Cutter Build card, so the card stock prints the same way.
    expect(ipl).toContain('\x0fL1320');
  });

  it('writes rotated ZPL fields on the 4 x 6.5 card', () => {
    const zpl = buildLocationCardZpl(SAMPLE).toString('utf8');
    expect(zpl).toContain('^PW832');
    expect(zpl).toContain('^LL1320');
    expect(zpl).toMatch(/\^A0R,\d+,\d+\^FD1\.955FC\^FS/);
    expect(zpl).toMatch(/\^BCR,120,N,N,N,N\^FDGSR-1\.955FC-RING\^FS/);
    expect(zpl).not.toMatch(/\^A0N/);
    for (const [, x, y] of zpl.matchAll(/\^FO(\d+),(\d+)/g)) {
      expect(Number(x)).toBeLessThanOrEqual(832);
      expect(Number(y)).toBeLessThanOrEqual(1320);
    }
  });

  it("moves every field by the printer's adjustment", () => {
    const plain = buildLocationCardZpl(SAMPLE).toString('utf8').match(/\^FO(\d+),(\d+)/);
    const moved = buildLocationCardZpl(SAMPLE, { right: 8, down: 16 }).toString('utf8').match(/\^FO(\d+),(\d+)/);
    expect(Number(moved?.[1])).toBe(Number(plain?.[1]) + 8);
    expect(Number(moved?.[2])).toBe(Number(plain?.[2]) + 16);
    const iplPlain = buildLocationCardIpl(SAMPLE).toString('latin1').match(/;o(\d+),(\d+);/);
    const iplMoved = buildLocationCardIpl(SAMPLE, { right: 8, down: 16 }).toString('latin1').match(/;o(\d+),(\d+);/);
    expect(Number(iplMoved?.[1])).toBe(Number(iplPlain?.[1]) - 16);
    expect(Number(iplMoved?.[2])).toBe(Number(iplPlain?.[2]) + 8);
  });

  it('keeps printer command characters out of the fields', () => {
    expect(buildLocationCardZpl({ ...SAMPLE, description: 'A^XZ~JR' }).toString('utf8')).not.toContain('^XZ~JR');
    expect(buildLocationCardIpl({ ...SAMPLE, description: 'a;b,c' }).toString('latin1')).toContain('a b c');
  });

  it('names the fallback file after the location', () => {
    expect(locationCardFileName('GSR-1.955FC-RING', 'IPL')).toBe('LOCATION-GSR-1.955FC-RING.prn');
    expect(locationCardFileName('bin 01/a', 'ZPL')).toBe('LOCATION-BIN_01_A.zpl');
  });
});
