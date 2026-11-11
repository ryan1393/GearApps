import { CycleTestsService, validateCycleTest } from './cycle-tests.service';
import { Macro } from '@meshforge/shared/domain';
const macro = (number: number, type = 'real', status = 1) => ({ number, type, status, name: `macro-${number}` } as Macro);
describe('cycle simulations', () => {
  it('validates configured types and preserves a definition snapshot', () => {
    const result = validateCycleTest([macro(1), macro(2, 'int'), macro(3, 'bool'), macro(4, 'int', 0)], { 1: 1.5, 2: 3, 3: -1 });
    expect(result.passed).toBe(true);
    expect(result.macros).toHaveLength(3);
    expect(result.macros[0]).toEqual({number: 1, name: 'macro-1', type: 'real', value: 1.5});
  });
  it('rejects missing, unknown, invalid flags, fractions for integer macros and overflowing values', () => {
    expect(validateCycleTest([], {}).passed).toBe(false);
    const result = validateCycleTest([macro(1), macro(2, 'int'), macro(3, 'bool'), macro(4)], { 2: 1.2, 3: 2, 4: 1e8, 99: 1 });
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(5);
    expect(result.macros[0].value).toBeNull();
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
