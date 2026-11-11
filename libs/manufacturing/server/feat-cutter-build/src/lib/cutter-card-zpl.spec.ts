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
    summary: 'S-55120',
    partType: 'RING',
    bladeCount: 11,
    sourceTray: 'T0012',
    status: 'BUILT',
    comments: 'Example comment',
    ...overrides,
  }).toString('utf8');

/** Every text field's value, in card order. */
const texts = (zpl: string) => [...zpl.matchAll(/\^A0N,\d+,\d+\^FD([^^]*)\^FS/g)].map((match) => match[1]);

/** Every ^GB box, as [x, y, width, height]. */
function boxes(zpl: string): number[][] {
  return [...zpl.matchAll(/\^FO(\d+),(\d+)\^GB(\d+),(\d+),\d+\^FS/g)].map((match) => match.slice(1).map(Number));
}

describe('cutter card ZPL', () => {
  it('is one label laid out like the PNG preview', () => {
    const zpl = card();

    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zpl.match(/\^XA/g)).toHaveLength(1);
    expect(texts(zpl)).toEqual([
      'MESHFORGE', 'CUTTER BUILD CARD', 'P1955FC-1042-001',
      'CUTTER BODY', '1042', 'SUMMARY', 'S-55120',
      'PART TYPE', 'RING', 'BLADE QTY', '11',
      'SOURCE TRAY', 'T0012', 'STATUS', 'BUILT',
      'BUILT BY', 'Pat Operator', 'MACHINE', 'G12',
      'HONED', 'NO', 'COATED', 'YES',
      'BUILT ON', '2026-11-10 11:34',
      'COMMENTS', 'Example comment',
    ]);
    // Code 128 of the build ID, three dots per module, and no hand-filled table.
    expect(zpl).toContain('^BY3,3,140');
    expect(zpl).toContain('^BCN,140,N,N,N,N^FDP1955FC-1042-001^FS');
    expect(zpl).not.toMatch(/PIECES|Reason:/);
  });

  it('says YES or NO for honed and coated', () => {
    const values = texts(card({ honed: true, coated: false }));
    expect(values[values.indexOf('HONED') + 1]).toBe('YES');
    expect(values[values.indexOf('COATED') + 1]).toBe('NO');
  });

  it('keeps every box, the barcode and the text on the 832 x 1320 dot card', () => {
    const longId = 'P1955FC-E2EMFWORKFLOW10520261110163415B78499-001';
    const zpl = card({ buildId: longId, bodyNumber: 'E2E-MF-WORKFLOW-105-20261110163415-B78499' });

    for (const [x, y, width, height] of boxes(zpl)) {
      expect(x + width).toBeLessThanOrEqual(832);
      expect(y + height).toBeLessThanOrEqual(1320);
    }
    const dots = Number(/\^BY(\d),3,140/.exec(zpl)?.[1]);
    const x = Number(/\^FO(\d+),\d+\^BC/.exec(zpl)?.[1]);
    expect(x + (11 * (longId.length + 2) + 13) * dots).toBeLessThanOrEqual(822);
    for (const [, textX, height, value] of zpl.matchAll(/\^FO(\d+),\d+\^A0N,(\d+),\d+\^FD([^^]*)\^FS/g)) {
      expect(Number(textX) + value.length * Number(height) * 0.6).toBeLessThanOrEqual(822);
    }
    // A value too long for its column is shortened, not printed across the next one.
    expect(zpl).toContain('...^FS');
    expect(zpl).not.toContain('B78499^FS');
  });

  it("moves every field by the printer's adjustment", () => {
    const origins = (zpl: string) => [...zpl.matchAll(/\^FO(\d+),(\d+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    const base = origins(card());
    const moved = origins(buildCutterCardZpl({ buildId: 'P1955FC-1042-001', buildDate: '2026-11-10 11:34', name: 'Pat Operator', bodyNumber: '1042', machine: 'G12', coated: true, honed: false, summary: 'S-55120', partType: 'RING', bladeCount: 11, sourceTray: 'T0012', status: 'BUILT', comments: 'Example comment' }, { right: 12, down: 30 }).toString('utf8'));

    expect(moved).toHaveLength(base.length);
    expect(moved).toEqual(base.map(([x, y]) => [x + 12, y + 30]));
  });

  it('keeps printer command characters out of the fields', () => {
    const zpl = card({ name: 'Pat^XZ~JR Operator', bodyNumber: '10^FD42', comments: 'See ^XA note' });

    expect(zpl.match(/\^XZ/g)).toHaveLength(1);
    expect(zpl.match(/\^XA/g)).toHaveLength(1);
    expect(zpl).not.toContain('~');
    expect(zpl).toContain('Pat XZ JR Operator');
  });
});
