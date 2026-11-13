import { DsfRefusal } from '../dsf-core';
import { HistoryPlan, HistorySource } from './dsf-history-model';
import {
  collectDsfHistory, dsfHistorySystemKey, HISTORY_CATALOG_SQL, HISTORY_COUNTS_SQL,
  HISTORY_EVENT_LIMIT, HISTORY_SHIFTS_SQL, historyHoursFromAggregate, historyShiftSlices,
  historySources, HistoryShiftRow,
} from './dsf-history-source';

const id = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const system = dsfHistorySystemKey({ host: 'dsf.example', database: 'maindblocal', port: 5432 });
const start = '2026-11-11T20:00:00.000000Z';
const end = '2026-11-11T21:00:00.000000Z';
const catalog = (value = 1, extra: Record<string, unknown> = {}) => ({
  mapping_id: id(value), whiteboard_id: id(value + 100), op_id: id(value + 200), line_id: id(value + 300),
  department_id: id(500), source_name: `Fixture ${value}`, line_name: `Line ${value}`, department_name: 'CUTTER GRIND',
  asset_number: `Asset ${value}`, mapping_active: true, whiteboard_active: true, identity_valid: true,
  active_mappings: 1, running_reasons: 1, ...extra,
});
const source = (value = 1, extra: Record<string, unknown> = {}): HistorySource => historySources([catalog(value, extra)], system)[0];
const shift = (own: HistorySource, extra: Partial<HistoryShiftRow> = {}): HistoryShiftRow => ({
  line_id: own.line_id, id: '1', number: 2, starts_at: start, ends_at: end, local_date: '2026-11-11', ...extra,
});
const total = (rows = 0, distinct = rows) => ({ kind: 'TOTAL', source_rows: String(rows), distinct_rows: String(distinct) });
const aggregate = (own: HistorySource, extra: Record<string, unknown> = {}) => ({
  kind: 'SOURCE', source_key: own.source_key, slice_key: 0, source_rows: '1', count: '1',
  invalid_parts: '0', invalid_reason: '0', wrong_whiteboard: '0', missing_slice: '0',
  last_production_at: '2026-11-11T20:15:00.123456Z', ...extra,
});
const plan: HistoryPlan = { system_key: system, backfill_start: start, backfill_hour: start, hours: [start] };

describe('DSF history source identities', () => {
  it('scopes a system without credentials, with database and port separation', () => {
    expect(dsfHistorySystemKey({ host: 'DSF.EXAMPLE', database: 'maindblocal', password: 'different', user: 'another' })).toBe(system);
    expect(dsfHistorySystemKey({ host: 'dsf.example', database: 'other', port: 5432 })).not.toBe(system);
    expect(dsfHistorySystemKey({ host: 'dsf.example', database: 'maindblocal', port: 5433 })).not.toBe(system);
    expect(() => dsfHistorySystemKey({ host: '', database: 'maindblocal' })).toThrow('HISTORY_SOURCE_SYSTEM');
  });

  it('includes named areas, inactive alternatives and duplicate-operation warnings', () => {
    const rows = historySources([
      catalog(1), catalog(2, { department_name: 'Hard Turn (Pinions)' }),
      catalog(3, { mapping_active: false }), catalog(4, { active_mappings: 2 }),
    ], system);
    expect(rows.map(row => row.department_name)).toEqual(['CUTTER GRIND', 'Hard Turn (Pinions)', 'CUTTER GRIND', 'CUTTER GRIND']);
    expect(rows[2].active).toBe(false);
    expect(rows[3].review_reason).toBe('DUPLICATE_OPERATION');
    expect(rows[3].duplicate_operation).toBe(true);
  });

  it('starts a new identity stream for source scope changes but not a display rename', () => {
    const original = source();
    expect(source(1, { source_name: 'Renamed machine' }).source_key).toBe(original.source_key);
    for (const column of ['whiteboard_id', 'op_id', 'line_id', 'department_id']) {
      expect(source(1, { [column]: id(999) }).source_key).not.toBe(original.source_key);
    }
    expect(() => historySources([catalog(), catalog()], system)).toThrow('HISTORY_CATALOG_DUPLICATE_KEY');
    expect(() => historySources([catalog(1, { mapping_id: 'bad' })], system)).toThrow('HISTORY_CATALOG_IDENTITY');
    expect(source(1, { identity_valid: false }).review_reason).toBe('INVALID_SOURCE_IDENTITY');
    expect(source(1, { running_reasons: 0 }).review_reason).toBe('NO_RUN_REASON');
  });

  it('isolates oversized source metadata without blocking healthy source commits', () => {
    const rows = historySources([catalog(1, { source_name: 'x'.repeat(501) }), catalog(2)], system);
    expect(rows[0].source_name).toHaveLength(500);
    expect(rows[0].review_reason).toBe('INVALID_SOURCE_IDENTITY');
    expect(rows[1].review_reason).toBeNull();
    expect(historySources([catalog(1, { source_name: 'x'.repeat(499) + '😀' })], system)[0].source_name).toHaveLength(499);
  });
});

describe('dated DSF history shift slices', () => {
  it('preserves arbitrary sub-hour boundaries and microseconds', () => {
    const own = source(), edge = '2026-11-11T20:30:00.000100Z';
    const slices = historyShiftSlices(own, start, end, [shift(own, { ends_at: edge }),
      shift(own, { id: '2', number: 3, starts_at: edge })]);
    expect(slices.map(row => [row.shift_id, row.slice_start, row.slice_end])).toEqual([
      ['1', start, edge], ['2', edge, end],
    ]);
  });

  it('normalizes a one-second end only when a real next start proves it', () => {
    const own = source();
    const previous = shift(own, { ends_at: '2026-11-11T20:29:59Z' });
    const next = shift(own, { id: '2', number: 3, starts_at: '2026-11-11T20:30:00Z' });
    expect(historyShiftSlices(own, start, end, [previous, next]).map(row => row.shift_id)).toEqual(['1', '2']);
    const unproven = historyShiftSlices(own, start, end, [previous]);
    expect(unproven.map(row => row.shift_id)).toEqual(['1', null]);
    expect(unproven[0].slice_end).toBe('2026-11-11T20:29:59.000000Z');
  });

  it('keeps gaps and overlaps explicitly unassigned', () => {
    const own = source();
    const gap = historyShiftSlices(own, start, end, [shift(own, { ends_at: '2026-11-11T20:20:00Z' }),
      shift(own, { id: '2', starts_at: '2026-11-11T20:40:00Z' })]);
    expect(gap.map(row => row.shift_id)).toEqual(['1', null, '2']);
    const overlap = historyShiftSlices(own, start, end, [shift(own, { ends_at: '2026-11-11T20:40:00Z' }),
      shift(own, { id: '2', starts_at: '2026-11-11T20:30:00Z' })]);
    expect(overlap.map(row => row.shift_id)).toEqual(['1', null, '2']);
    expect(historyShiftSlices(own, start, end, []).map(row => row.shift_id)).toEqual([null]);
  });

  it('preserves cross-midnight shift dates and repeated DST hours as distinct UTC windows', () => {
    const own = source();
    const night = shift(own, { starts_at: '2026-11-12T03:30:00Z', ends_at: '2026-11-12T11:00:00Z' });
    const afterMidnight = historyShiftSlices(own, '2026-11-12T05:00:00Z', '2026-11-12T06:00:00Z', [night]);
    expect(afterMidnight[0].shift_date).toBe('2026-11-11');
    const fall = shift(own, { starts_at: '2026-11-01T04:00:00Z', ends_at: '2026-11-01T13:00:00Z', local_date: '2026-11-01' });
    const first = historyShiftSlices(own, '2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z', [fall]);
    const repeated = historyShiftSlices(own, '2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z', [fall]);
    expect(first[0].shift_id).toBe(repeated[0].shift_id);
    expect(first[0].hour_start).not.toBe(repeated[0].hour_start);
    expect(first[0].shift_date).toBe('2026-11-01');
  });
});

describe('validated hourly aggregates', () => {
  it('distinguishes verified empty zero from unavailable or capped evidence', () => {
    const own = source(), slices = new Map([[own.source_key, historyShiftSlices(own, start, end, [])]]);
    const valid = historyHoursFromAggregate([own], start, end, slices, [total()]);
    expect(valid.hours[0].count).toBe(0);
    expect(valid.hours[0].slices[0].shift_id).toBeNull();
    expect(valid.issues).toEqual([]);
    expect(historyHoursFromAggregate([own], start, end, slices, []).hours).toEqual([]);
    const limited = historyHoursFromAggregate([own], start, end, slices, [total(HISTORY_EVENT_LIMIT + 1)]);
    expect(limited.hours).toEqual([]);
    expect(limited.issues[0].code).toBe('HISTORY_EVENT_LIMIT');
    expect(historyHoursFromAggregate([own], start, end, slices, [total(2, 1)]).issues[0].code).toBe('HISTORY_DUPLICATE_EVENT_KEY');
  });

  it('assigns counts to exact slices and replaces rather than accumulating repeated totals', () => {
    const own = source(), edge = '2026-11-11T20:30:00.000100Z';
    const slices = new Map([[own.source_key, historyShiftSlices(own, start, end, [shift(own, { ends_at: edge }), shift(own, { id: '2', starts_at: edge })])]]);
    const rows = [total(2), aggregate(own, { count: '3' }), aggregate(own, { slice_key: 1, count: '5', last_production_at: edge })];
    const first = historyHoursFromAggregate([own], start, end, slices, rows);
    expect(first.hours[0].count).toBe(8);
    expect(first.hours[0].slices.map(row => row.count)).toEqual([3, 5]);
    expect(historyHoursFromAggregate([own], start, end, slices, rows)).toEqual(first);
    expect(historyHoursFromAggregate([own], start, end, slices, [total()]).hours[0].count).toBe(0);
    expect(slices.get(own.source_key)?.map(row => row.count)).toEqual([0, 0]);
  });

  it.each([
    ['invalid_parts', 'HISTORY_INVALID_PART_COUNT'], ['invalid_reason', 'HISTORY_UNRESOLVED_REASON'],
    ['wrong_whiteboard', 'HISTORY_WHITEBOARD_MISMATCH'], ['missing_slice', 'HISTORY_MISSING_SHIFT_SLICES'],
  ])('rejects %s without replacing healthy sources with zero', (column, code) => {
    const own = source(), other = source(2);
    const slices = new Map([own, other].map(row => [row.source_key, historyShiftSlices(row, start, end, [])]));
    const result = historyHoursFromAggregate([own, other], start, end, slices, [total(1), aggregate(own, { [column]: '1' })]);
    expect(result.hours.map(row => [row.source_key, row.count])).toEqual([[other.source_key, 0]]);
    expect(result.issues).toContainEqual({ source_key: own.source_key, hour_start: start, code });
  });

  it('rejects overflow, unsafe timestamps, incomplete slices and inconsistent aggregate responses', () => {
    const own = source(), parts = historyShiftSlices(own, start, end, []), slices = new Map([[own.source_key, parts]]);
    for (const extra of [{ count: '9007199254740992' }, { last_production_at: end }, { slice_key: 999 }, { source_rows: '0' }]) {
      expect(historyHoursFromAggregate([own], start, end, slices, [total(1), aggregate(own, extra)]).hours).toEqual([]);
    }
    expect(historyHoursFromAggregate([own], start, end, slices, [total(2), aggregate(own)]).issues[0].code).toBe('HISTORY_AGGREGATE_MISMATCH');
    const broken = new Map([[own.source_key, [{ ...parts[0], slice_start: '2026-11-11T20:01:00Z' }]]]);
    expect(historyHoursFromAggregate([own], start, end, broken, [total()]).hours).toEqual([]);
  });

  it('archives duplicate mappings independently while preserving their review flags', () => {
    const own = source(1, { active_mappings: 2 });
    const slices = new Map([[own.source_key, historyShiftSlices(own, start, end, [])]]);
    const result = historyHoursFromAggregate([own], start, end, slices, [total(1), aggregate(own)]);
    expect(result.hours[0].count).toBe(1);
    expect(own.duplicate_operation).toBe(true);
  });
});

describe('serialized source history collection', () => {
  const rows = [catalog(1), catalog(2, { department_name: 'Hard Turn (Rings)' })];
  const fake = (counts: unknown[] = [total()]) => ({ query: jest.fn(async (sql: string, parameters?: unknown[]) => {
    if (sql === HISTORY_CATALOG_SQL) return { rows };
    if (sql === HISTORY_SHIFTS_SQL) return { rows: [] };
    if (sql === HISTORY_COUNTS_SQL) { expect(parameters).toHaveLength(3); return { rows: counts }; }
    throw new Error('Unexpected statement');
  }) });

  it('uses one aggregate scan for all sources and advances only a complete closed backfill hour', async () => {
    const client = fake();
    const capture = await collectDsfHistory(client, end, plan);
    expect(capture.sources.map(row => row.department_name)).toContain('Hard Turn (Rings)');
    expect(capture.hours).toHaveLength(2);
    expect(capture.hours.every(row => row.count === 0)).toBe(true);
    expect(capture.next_backfill_hour).toBe(end);
    expect(client.query).toHaveBeenCalledTimes(3);
    const scope = JSON.parse(String(client.query.mock.calls[2][1]?.[2]));
    expect(scope).toHaveLength(2);
  });

  it('does not advance or invent zeros on incomplete source evidence', async () => {
    const capture = await collectDsfHistory(fake([total(HISTORY_EVENT_LIMIT + 1)]), end, plan);
    expect(capture.hours).toEqual([]);
    expect(capture.next_backfill_hour).toBe(start);
    expect(capture.issues[0].code).toBe('HISTORY_EVENT_LIMIT');
    const partial = await collectDsfHistory(fake(), '2026-11-11T20:05:00Z', plan);
    expect(partial.hours[0].covered_to).toBe('2026-11-11T20:05:00.000000Z');
    expect(partial.next_backfill_hour).toBe(start);
  });

  it('advances scan progress past scoped failures while retaining the missing source-hour issue', async () => {
    const own = source();
    const capture = await collectDsfHistory(fake([total(1), aggregate(own, { invalid_reason: '1' })]), end, plan);
    expect(capture.hours).toHaveLength(1);
    expect(capture.hours[0].source_key).not.toBe(own.source_key);
    expect(capture.issues).toContainEqual({ source_key: own.source_key, hour_start: start, code: 'HISTORY_UNRESOLVED_REASON' });
    expect(capture.next_backfill_hour).toBe(end);
  });

  it('does not let a retired alias without RUN reasons pin healthy source backfill', async () => {
    const client = { query: jest.fn(async (sql: string) => ({ rows: sql === HISTORY_CATALOG_SQL
      ? [catalog(1), catalog(2, { mapping_active: false, running_reasons: 0 })]
      : sql === HISTORY_SHIFTS_SQL ? [] : [total()] })) };
    const capture = await collectDsfHistory(client, end, plan);
    expect(capture.hours).toHaveLength(1);
    expect(capture.issues[0].code).toBe('NO_RUN_REASON');
    expect(capture.next_backfill_hour).toBe(end);
  });

  it('rejects invalid or duplicate canonical hour plans before querying', async () => {
    const client = fake();
    await expect(collectDsfHistory(client, end, { ...plan, hours: [start, '2026-11-11T15:00:00-05:00'] })).rejects.toBeInstanceOf(DsfRefusal);
    await expect(collectDsfHistory(client, end, { ...plan, hours: ['2026-11-11T20:01:00Z'] })).rejects.toBeInstanceOf(DsfRefusal);
    expect(client.query).not.toHaveBeenCalled();
  });
});
