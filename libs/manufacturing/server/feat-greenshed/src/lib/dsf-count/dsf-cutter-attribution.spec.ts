import { chooseShift, reconcileRows, timestampUs, DsfCycle } from './dsf-core';
import { creditedCycles, desiredCutterShiftCount } from './dsf-cutter-attribution';

const OP = 'op';
const shift = chooseShift([
  { id: '1', number: 1, starts_at: '2026-11-10T12:00:00.000000Z', ends_at: '2026-11-10T20:00:00.000000Z', local_date: '2026-11-10' },
], '2026-11-10T16:00:00.000000Z');
let nextId = 1;
const run = (at: string, parts = 1): DsfCycle => ({ id: String(nextId++), at_us: timestampUs(at).toString(), at, parts, reason_code: '1', reason_op: OP });
const cache = reconcileRows(undefined, shift, shift.starts_at, '2026-11-10T16:00:00.000000Z', [
  run('2026-11-10T12:30:00.000000Z', 10), // before the cutter was installed
  run('2026-11-10T14:00:00.000000Z', 4),
  run('2026-11-10T15:00:00.000000Z', 3),
  run('2026-11-10T15:30:00.000000Z', 2),
], OP, true, 'now');

describe('DSF cutter attribution amounts', () => {
  it('counts RUN pieces from a start time up to, not including, the read time', () => {
    expect(creditedCycles(cache, timestampUs(shift.starts_at))).toBe(19);
    expect(creditedCycles(cache, timestampUs('2026-11-10T15:00:00.000000Z'))).toBe(5);
  });

  it('credits a cutter only with pieces made after it was installed in this shift', () => {
    expect(desiredCutterShiftCount(cache, '2026-11-10T13:00:00.000000Z', null, 'run-1')).toBe(9);
  });

  it('credits the whole shift so far to a cutter installed in an earlier shift', () => {
    expect(desiredCutterShiftCount(cache, '2026-11-09T22:00:00.000000Z', null, 'run-1')).toBe(19);
  });

  it('starts at the activation baseline for the run and shift where crediting began', () => {
    const anchor = { seeded_run_id: 'run-1', seeded_shift_start: shift.starts_at, seeded_at: '2026-11-10T14:30:00.000000Z', seeded_source_count: 14 };
    // Installed yesterday, DSF crediting activated 14:30 today: only the 15:00 and 15:30 pieces count.
    expect(desiredCutterShiftCount(cache, '2026-11-09T22:00:00.000000Z', anchor, 'run-1')).toBe(5);
    // At the activation read itself nothing is credited: the existing count stands.
    const atActivation = { ...anchor, seeded_at: cache.as_of };
    expect(desiredCutterShiftCount(cache, '2026-11-09T22:00:00.000000Z', atActivation, 'run-1')).toBe(0);
  });

  it('ignores the baseline for a different cutter run or a later shift', () => {
    const anchor = { seeded_run_id: 'run-1', seeded_shift_start: shift.starts_at, seeded_at: '2026-11-10T14:30:00.000000Z', seeded_source_count: 14 };
    expect(desiredCutterShiftCount(cache, '2026-11-10T13:00:00.000000Z', anchor, 'run-2')).toBe(9);
    const earlierShift = { ...anchor, seeded_shift_start: '2026-11-10T04:00:00.000000Z', seeded_at: '2026-11-10T05:00:00.000000Z' };
    expect(desiredCutterShiftCount(cache, '2026-11-09T22:00:00.000000Z', earlierShift, 'run-1')).toBe(19);
  });
});
