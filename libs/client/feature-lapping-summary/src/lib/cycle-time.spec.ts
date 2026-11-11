import { formatCycleTime } from '@meshforge/shared/domain';

describe('formatCycleTime', () => {
  it('shows minutes, seconds and tenths', () => {
    expect(formatCycleTime(124.25)).toBe('2:04.3');
    expect(formatCycleTime(45.2)).toBe('0:45.2');
    expect(formatCycleTime(60)).toBe('1:00.0');
    expect(formatCycleTime(0)).toBe('0:00.0');
  });

  it('carries a rounded-up minute instead of showing 60 seconds', () => {
    expect(formatCycleTime(59.96)).toBe('1:00.0');
    expect(formatCycleTime(119.97)).toBe('2:00.0');
  });

  it('shows an em dash when the time is unknown', () => {
    for (const unknown of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatCycleTime(unknown)).toBe('—');
    }
  });
});
