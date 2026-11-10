import { buildCutterCardZpl } from './cutter-card-zpl';

const card = (overrides: Partial<Parameters<typeof buildCutterCardZpl>[0]> = {}) =>
  buildCutterCardZpl({
    buildId: 'P1955FC-1042-001',
    buildDate: '2026-11-10 11:34',
    name: 'Pat Operator',
    bodyNumber: '1042',
    machine: 'G12',
    coated: true,
    honed: false,
    ...overrides,
  }).toString('utf8');

/** Every ^FO origin and ^GB box, as [x, y, width, height]. */
function boxes(zpl: string): number[][] {
  return [...zpl.matchAll(/\^FO(\d+),(\d+)\^GB(\d+),(\d+),\d+\^FS/g)].map((match) => match.slice(1).map(Number));
}

describe('cutter card ZPL', () => {
  it('is one complete label carrying the same fields as the IPL card', () => {
    const zpl = card();

    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zpl.match(/\^XA/g)).toHaveLength(1);
    for (const value of ['Build ID:', 'P1955FC-1042-001', 'Body Number:', '^FD1042^FS', 'Name:', 'Pat Operator', 'Build Date:', '2026-11-10 11:34', 'Machine:', '^FDG12^FS', 'Honed:', 'Coated:', 'DATE', 'MACHINE', 'PIECES', 'Reason:']) {
      expect(zpl).toContain(value);
    }
    // Code 128 of the build ID, three dots per module.
    expect(zpl).toContain('^BY3,3,51');
    expect(zpl).toContain('^BCN,51,N,N,N,A^FDP1955FC-1042-001^FS');
  });

  it('marks only the boxes that apply', () => {
    expect(card({ coated: true, honed: false }).match(/\^FDX\^FS/g)).toHaveLength(1);
    expect(card({ coated: true, honed: true }).match(/\^FDX\^FS/g)).toHaveLength(2);
    expect(card({ coated: false, honed: false })).not.toContain('^FDX^FS');
  });

  it('keeps every box and the barcode on the 832 x 1320 dot card', () => {
    const longId = 'P1955FC-E2EMFWORKFLOW10520261110163415B78499-001';
    const zpl = card({ buildId: longId, bodyNumber: 'E2E-MF-WORKFLOW-105-20261110163415-B78499' });

    for (const [x, y, width, height] of boxes(zpl)) {
      expect(x + width).toBeLessThanOrEqual(832);
      expect(y + height).toBeLessThanOrEqual(1320);
    }
    const [, dots] = /\^BY(\d),3,51/.exec(zpl)!.map(Number);
    expect(17 + (11 * (longId.length + 2) + 13) * dots).toBeLessThanOrEqual(832);
    // A value too long for its cell is shortened, not printed across the next one.
    expect(zpl).toContain('...^FS');
    expect(zpl).not.toContain('B78499^FS');
  });

  it("moves every field by the printer's adjustment", () => {
    const fields = { buildId: 'P1955FC-1042-001', buildDate: '2026-11-10 11:34', name: 'Pat', bodyNumber: '1042', machine: 'G12', coated: true, honed: false };
    const origins = (zpl: string) => [...zpl.matchAll(/\^FO(\d+),(\d+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    const base = origins(buildCutterCardZpl(fields).toString('utf8'));
    const moved = origins(buildCutterCardZpl(fields, { right: 12, down: 30 }).toString('utf8'));

    expect(moved).toHaveLength(base.length);
    expect(moved).toEqual(base.map(([x, y]) => [x + 12, y + 30]));
  });

  it('keeps printer command characters out of the fields', () => {
    const zpl = card({ name: 'Pat^XZ~JR Operator', bodyNumber: '10^FD42' });

    expect(zpl.match(/\^XZ/g)).toHaveLength(1);
    expect(zpl).not.toContain('~');
    expect(zpl).toContain('Pat XZ JR Operator');
  });
});
