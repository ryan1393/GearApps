import { bladeLabelProblem, normalizeBladeLabel, normalizeSummaryHos, summaryHosProblem } from './summary-part-type-blades.constants';

describe('Summary + Part Type HOS and blade labels', () => {
  it('keeps the label words and never moves or rewrites an IB/OB suffix', () => {
    expect(normalizeBladeLabel('  rh   ib ')).toBe('RH IB');
    expect(normalizeBladeLabel('RH IB')).toBe('RH IB');
    expect(normalizeBladeLabel('')).toBeNull();
    expect(normalizeBladeLabel(null)).toBeNull();
  });
  it('accepts an IB label in any position and labels of different hands', () => {
    for (const label of ['RH IB', 'LH IB', 'RH OB', 'LH OB', 'RH-IB 2']) expect(bladeLabelProblem(label)).toBeNull();
  });
  it('refuses labels that are too long or contain other characters', () => {
    expect(bladeLabelProblem('RH IB; DROP')).toContain('may contain only');
    expect(bladeLabelProblem('X'.repeat(33))).toContain('longer than');
  });
  it('accepts RH, LH or blank HOS only', () => {
    expect(normalizeSummaryHos(' rh ')).toBe('RH');
    expect(summaryHosProblem('LH')).toBeNull();
    expect(summaryHosProblem('')).toBeNull();
    expect(summaryHosProblem('Right')).toContain('RH or LH');
  });
});
