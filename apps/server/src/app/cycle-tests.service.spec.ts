import { CycleTestsService, validateCycleTest } from './cycle-tests.service';
import { Macro } from '@meshforge/shared/domain';
const macro = (number: number, type = 'real', status = 1) => ({ number, type, status, name: `macro-${number}` } as Macro);
describe('cycle simulations', () => {
  it('validates configured types and preserves a definition snapshot', () => {
    const result = validateCycleTest([macro(1), macro(2, 'int'), macro(3, 'bool'), macro(4, 'int', 0)], { 1: 1.5, 2: 3, 3: -1 });
    expect(result.passed).toBe(true);
    expect(result.macros).toHaveLength(3);
    expect(result.macros[0]).toEqual({number: 1, name: 'macro-1', type: 'real', value: 1.5, min_value: null, max_value: null, unit: null});
  });
  it('rejects missing, unknown, invalid flags, fractions for integer macros and overflowing values', () => {
    expect(validateCycleTest([], {}).passed).toBe(false);
    const result = validateCycleTest([macro(1), macro(2, 'int'), macro(3, 'bool'), macro(4)], { 2: 1.2, 3: 2, 4: 1e8, 99: 1 });
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(5);
    expect(result.macros[0].value).toBeNull();
  });
  it('fails a value outside the limits set for its macro and names the limit', () => {
    const limited = { ...macro(1), min_value: 2, max_value: 5, unit: 'mm' } as Macro;
    const floor = { ...macro(2), min_value: 10 } as Macro;
    expect(validateCycleTest([limited, floor], { 1: 2, 2: 10 }).passed).toBe(true);
    expect(validateCycleTest([limited, floor], { 1: 5, 2: 400 }).passed).toBe(true);
    const result = validateCycleTest([limited, floor], { 1: 5.01, 2: 9 });
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual([
      'Macro #1 (macro-1) is 5.01, above its limit of 2 to 5 mm.',
      'Macro #2 (macro-2) is 9, below its limit of at least 10.',
    ]);
    expect(result.macros[0]).toMatchObject({ min_value: 2, max_value: 5, unit: 'mm' });
  });
  it('saves failed simulations exclusively to the test table, never production history', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT * FROM lapper.macros') ? [macro(1)] : sql.includes('INSERT') ? [{kind: 'SIMULATION'}] : [{id: 'configured'}]);
    const db = { transaction: (fn: (manager: { query: typeof query }) => unknown) => fn({query}) };
    const service = new CycleTestsService(db as never);
    await service.create({machine_id:'machine',gearset_id:'gearset',serial_number:' TEST-001 ',values:{}},'user');
    const inserts = query.mock.calls.map(([sql]) => sql).filter(sql => sql.includes('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain('lapper.cycle_tests');
    expect(inserts[0]).not.toContain('machine_cycles');
  });
});
