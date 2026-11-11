import { buildCutterCardIpl, cutterCardBuildDate, moveCutterCardIpl } from './cutter-card-ipl';
import { CutterCardFields } from './cutter-card-layout';

const fields: CutterCardFields = {
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
};

/** Every text field's printed value, in card order. */
// eslint-disable-next-line no-control-regex -- IPL fields are framed by STX and ETX.
const texts = (ipl: string) => [...ipl.matchAll(/\x02H\d+,Text\d+;[^\x03]*?;d3,([^;]*);\x03/g)].map((match) => match[1]);

describe('cutter card IPL', () => {
  it('prints the build date in plant time, not the API host time', () => {
    // Evening builds in standard and daylight time: both are still the plant's previous calendar day in UTC.
    expect(cutterCardBuildDate('2026-11-11T00:30:00.000Z')).toBe('2026-11-10 19:30');
    expect(cutterCardBuildDate(new Date('2026-07-01T03:15:00.000Z'))).toBe('2026-06-30 23:15');
    expect(cutterCardBuildDate('2026-03-02T05:00:00.000Z')).toBe('2026-03-02 00:00');
  });

  it('is the same card as the PNG preview: header, barcode, labelled values, build time and comments', () => {
    const card = buildCutterCardIpl(fields).toString('latin1');

    expect(texts(card)).toEqual([
      'MESHFORGE', 'CUTTER BUILD CARD', 'P1955FC-1042-001',
      'CUTTER BODY', '1042', 'SUMMARY', 'S-55120',
      'PART TYPE', 'RING', 'BLADE QTY', '11',
      'SOURCE TRAY', 'T0012', 'STATUS', 'BUILT',
      'BUILT BY', 'Pat Operator', 'MACHINE', 'G12',
      'HONED', 'NO', 'COATED', 'YES',
      'BUILT ON', '2026-11-10 11:34',
      'COMMENTS', 'Example comment',
    ]);
    expect(card).toContain(';f3;h140;w3;c6;i0;d3,P1955FC-1042-001;');
    // The old hand-filled table is gone.
    expect(card).not.toMatch(/PIECES|Reason:/);
  });

  it('keeps the printer setup of the supplied template and prints one card', () => {
    const card = buildCutterCardIpl(fields).toString('latin1');

    expect(card.startsWith('\x02R\x03\r\n\x02\x1bk\x03')).toBe(true);
    expect(card).toContain('\x02E*;F*;\x03');
    expect(card).toContain('\x0fL1320');
    expect(card.trimEnd().endsWith('\x02\x1e1\x03\x02\x1f1\x03\x02\x17\x03')).toBe(true);
  });

  it('keeps printer control characters and separators out of the fields', () => {
    const card = buildCutterCardIpl({ ...fields, name: 'Pat; Operator\x02', comments: 'Hold, then; release' }).toString('latin1');

    expect(texts(card)).toContain('Pat Operator');
    expect(texts(card)).toContain('Hold then release');
  });

  it('shows a dash for an empty value and wraps long comments onto a second line', () => {
    const comments = 'A much longer comment that runs past the first line of the card and carries on below.';
    const values = texts(buildCutterCardIpl({ ...fields, sourceTray: '', comments }).toString('latin1'));

    expect(values[values.indexOf('SOURCE TRAY') + 1]).toBe('-');
    expect(values.slice(-2).join(' ')).toBe(comments);
  });

  it('keeps every field on the card across the web', () => {
    const card = buildCutterCardIpl({ ...fields, buildId: 'P1955FC-E2EMFWORKFLOW10520261110163415B78499-001', bodyNumber: 'E2E-MF-WORKFLOW-105-20261110163415-B78499' }).toString('latin1');
    for (const [, feed, across] of card.matchAll(/;o(\d+),(\d+);/g)) {
      expect(Number(feed)).toBeLessThanOrEqual(1265);
      expect(Number(across)).toBeGreaterThanOrEqual(52);
      expect(Number(across)).toBeLessThan(42 + 832);
    }
    // A value too long for its column is shortened, not printed across the next one.
    expect(card).toContain('...;');
    expect(card).not.toContain('B78499;');
  });

  it("moves every field of the card by the printer's adjustment and leaves the rest alone", () => {
    const card = buildCutterCardIpl(fields);
    const origins = (text: string) => [...text.matchAll(/;o(\d+),(\d+);/g)].map((match) => [Number(match[1]), Number(match[2])]);
    const before = card.toString('latin1');
    const after = moveCutterCardIpl(card, { right: 10, down: 25 }).toString('latin1');

    // Across the web is the second value; down the card is toward the smaller feed value.
    expect(origins(after)).toEqual(origins(before).map(([feed, across]) => [feed - 25, across + 10]));
    expect(after.replace(/;o\d+,\d+;/g, ';o;')).toBe(before.replace(/;o\d+,\d+;/g, ';o;'));
    expect(moveCutterCardIpl(card, { right: 0, down: 0 })).toBe(card);
  });
});
