import { DsfCache, DsfCycle, DsfRefusal, DsfShiftRow, chooseShift, reconcileRows, replacementStart, safeCountRow, timestampUs } from './dsf-core';

const OP = '603ff1d6-bbb2-4afc-a059-f5af7cd6786a';
const shiftRows: DsfShiftRow[] = [
  { id: '1', number: 1, starts_at: '2026-11-10T12:00:00.000000Z', ends_at: '2026-11-10T19:59:59.000000Z', local_date: '2026-11-10' },
  { id: '2', number: 2, starts_at: '2026-11-10T20:00:00.000000Z', ends_at: '2026-11-11T03:59:59.000000Z', local_date: '2026-11-10' },
];
let nextId = 1;
function cycle(at: string, parts = 1, reason: string | null = '1', op: string | null = OP): DsfCycle {
  return { id: String(nextId++), at_us: timestampUs(at).toString(), at, parts, reason_code: reason, reason_op: op };
}
function refusal(run: () => unknown): string {
  try { run(); } catch (e) { return e instanceof DsfRefusal ? e.reason : 'OTHER'; }
  return 'NONE';
}

describe('DSF shift selection', () => {
  it('keeps microsecond precision in timestamps', () => {
    expect(timestampUs('2026-11-10T15:30:02.123456Z')).toBe(1794324602123456n);
    expect(timestampUs('2026-11-10T15:30:02.123457Z') - timestampUs('2026-11-10T15:30:02.123456Z')).toBe(1n);
  });

  it('picks the one shift containing the read time and closes the one-second gap to the next shift', () => {
    const shift = chooseShift(shiftRows, '2026-11-10T16:00:00.000000Z');
    expect(shift.number).toBe(1);
    expect(shift.effective_end).toBe('2026-11-10T20:00:00.000000Z');
    // 19:59:59.5 falls in the source's one-second gap; it still belongs to shift 1.
    expect(chooseShift(shiftRows, '2026-11-10T19:59:59.500000Z').number).toBe(1);
  });

  it('refuses when no shift, or more than one, contains the read time', () => {
    expect(refusal(() => chooseShift(shiftRows, '2026-11-12T16:00:00.000000Z'))).toBe('MISSING_OR_OVERLAPPING_SHIFT');
    const overlapping = [...shiftRows, { ...shiftRows[0], id: '9' }];
    expect(refusal(() => chooseShift(overlapping, '2026-11-10T16:00:00.000000Z'))).toBe('MISSING_OR_OVERLAPPING_SHIFT');
  });
});

describe('DSF event reconciliation', () => {
  const shift = chooseShift(shiftRows, '2026-11-10T16:00:00.000000Z');
  const full = (rows: DsfCycle[], until: string) => reconcileRows(undefined, shift, shift.starts_at, until, rows, OP, true, until);

  it('sums part_count of RUN events only, not the number of rows', () => {
    const cache = full([
      cycle('2026-11-10T12:10:00.000001Z', 2),
      cycle('2026-11-10T12:11:00.000000Z', 1),
      cycle('2026-11-10T12:12:00.000000Z', 5, '2'), // not RUN
    ], '2026-11-10T13:00:00.000000Z');
    expect(cache.count).toBe(3);
  });

  it('replaces the whole overlap on an incremental read, so a re-read never double counts', () => {
    const first = cycle('2026-11-10T12:10:00.000000Z');
    const second = cycle('2026-11-10T12:50:00.000000Z');
    const baseline = full([first, second], '2026-11-10T13:00:00.000000Z');
    expect(baseline.count).toBe(2);
    // Overlap window starts 12:30: `second` is read again and one new event arrives.
    const third = cycle('2026-11-10T13:05:00.000000Z');
    const next = reconcileRows(baseline, shift, '2026-11-10T12:30:00.000000Z', '2026-11-10T13:10:00.000000Z', [second, third], OP, false, 'x');
    expect(next.count).toBe(3);
    // An event that disappeared from the overlap is dropped, not kept from the old read.
    const corrected = reconcileRows(baseline, shift, '2026-11-10T12:30:00.000000Z', '2026-11-10T13:10:00.000000Z', [third], OP, false, 'x');
    expect(corrected.count).toBe(2);
  });

  it('refuses bad evidence instead of filtering it out', () => {
    const until = '2026-11-10T13:00:00.000000Z';
    const duplicate = cycle('2026-11-10T12:10:00.000000Z');
    expect(refusal(() => full([duplicate, { ...duplicate }], until))).toBe('DUPLICATE_SOURCE_KEY');
    expect(refusal(() => full([cycle('2026-11-10T12:10:00.000000Z', -1)], until))).toBe('INVALID_PART_COUNT');
    expect(refusal(() => full([cycle('2026-11-10T12:10:00.000000Z', 1, '1', 'another-op')], until))).toBe('UNRESOLVED_REASON');
    expect(refusal(() => full([cycle('2026-11-10T14:00:00.000000Z')], until))).toBe('CYCLE_OUTSIDE_WINDOW');
    const tooMany = Array.from({ length: 10001 }, (_, i) => cycle(`2026-11-10T12:10:00.${String(i).padStart(6, '0')}Z`));
    expect(refusal(() => full(tooMany, until))).toBe('CYCLE_ROW_LIMIT');
  });

  it('re-reads the whole shift for a new shift or after the reconcile interval, else only the overlap', () => {
    const cache = full([], '2026-11-10T13:00:00.000000Z');
    expect(replacementStart(undefined, shift, '2026-11-10T13:00:30.000000Z', 1800, 1800)).toEqual({ from: shift.starts_at, full: true });
    expect(replacementStart(cache, shift, '2026-11-10T13:01:00.000000Z', 1800, 1800)).toEqual({ from: '2026-11-10T12:30:00.000000Z', full: false });
    expect(replacementStart(cache, shift, '2026-11-10T13:31:00.000000Z', 1800, 1800).full).toBe(true);
  });

  it('publishes no count once the shift has ended or the mapping needs review', () => {
    const machine = { machine_id: 'm', machine_number: '516', department: '132' };
    const cache: DsfCache = full([cycle('2026-11-10T12:10:00.000000Z')], '2026-11-10T13:00:00.000000Z');
    expect(safeCountRow(machine, cache, 'OK', '', '2026-11-10T13:00:20.000000Z', 150).count).toBe(1);
    expect(safeCountRow(machine, cache, 'OK', '', '2026-11-10T13:10:00.000000Z', 150).status).toBe('STALE');
    // A count read seconds before the shift ended must not be shown as the new shift's count.
    const lateRead: DsfCache = full([cycle('2026-11-10T12:10:00.000000Z')], '2026-11-10T19:59:50.000000Z');
    const ended = safeCountRow(machine, lateRead, 'OK', '', '2026-11-10T20:00:01.000000Z', 150);
    expect(ended.count).toBeNull();
    expect(ended.status).toBe('WAITING');
    expect(safeCountRow(machine, cache, 'MAPPING_REVIEW', 'review', '2026-11-10T13:00:20.000000Z', 150).count).toBeNull();
  });
});
