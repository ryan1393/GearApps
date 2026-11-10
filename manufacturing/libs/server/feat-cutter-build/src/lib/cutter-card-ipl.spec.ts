import { buildCutterCardIpl, cutterCardBuildDate } from './cutter-card-ipl';

describe('cutter card IPL', () => {
  it('prints the build date in plant time, not the API host time', () => {
    // Evening builds in standard and daylight time: both are still the plant's previous calendar day in UTC.
    expect(cutterCardBuildDate('2026-11-11T00:30:00.000Z')).toBe('2026-11-10 19:30');
    expect(cutterCardBuildDate(new Date('2026-07-01T03:15:00.000Z'))).toBe('2026-06-30 23:15');
    expect(cutterCardBuildDate('2026-03-02T05:00:00.000Z')).toBe('2026-03-02 00:00');
  });

  it('fills every template field and keeps printer control characters out of them', () => {
    const card = buildCutterCardIpl({
      buildId: 'P1955FC-1042-001',
      buildDate: cutterCardBuildDate('2026-11-10T16:34:00.000Z'),
      name: 'Pat; Operator\x02',
      bodyNumber: '1042',
      machine: 'G12',
      coated: true,
      honed: false,
    }).toString('latin1');

    expect(card).not.toMatch(/\$(BuildID|Date|Name|BodyNumber|Machine|XCoated|XHoned)/);
    expect(card).toContain('c6;i0;d3,P1955FC-1042-001;');
    expect(card).toContain('d3,2026-11-10 11:34;');
    expect(card).toContain('d3,Pat Operator;');
    expect(card).toContain('Coated  ;o1080,570;f3;h1;w1;c31;r0;b0;d3,X;');
    expect(card).toContain('Honed   ;o1127,571;f3;h1;w1;c31;r0;b0;d3,;');
  });
});
