import { ARGONAUT_MACROS, FLAGGABLE_MACROS, macroCanFlagChanges } from '@meshforge/shared/domain';
import { PostgresLapperCatalog } from './catalog';
import { PostgresLapperStore } from './postgres-lapper.store';
import { LAPPER_ARGONAUT_FLAGS_MIGRATION, LAPPER_ARGONAUT_FLAGS_SQL } from './schema';

/** Setting changes flag only the macros sent to Argonaut, never the consec counter #10032. */
describe('Lapper setting-change flags', () => {
  it('are the 68 macros sent to Argonaut, without #10032', () => {
    expect(ARGONAUT_MACROS).toHaveLength(68);
    expect(FLAGGABLE_MACROS).toEqual(ARGONAUT_MACROS);
    expect(macroCanFlagChanges(10032)).toBe(false);
    expect(macroCanFlagChanges(10039)).toBe(true); // a float macro
    expect(macroCanFlagChanges('10480')).toBe(true); // a string macro, as a form gives it
    expect(macroCanFlagChanges(10041)).toBe(false); // read from the controller, not sent to Argonaut
  });

  it('are the only macros the setting-changes query reads, besides each macro’s own Flag changes', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const catalog = new PostgresLapperCatalog({ query } as never, { get: () => 'America/Indiana/Indianapolis' } as never);
    await catalog.settingChanges(8, 50);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE m.flag_changes AND m.number = ANY($3::int[])');
    expect(params[2]).toEqual(FLAGGABLE_MACROS);
    expect(params[2]).not.toContain(10032);
  });

  it('are ticked on, and every other macro off, by a one-time migration whose list matches the code', () => {
    expect(LAPPER_ARGONAUT_FLAGS_MIGRATION).toBe('20261112-lapper-macro-flag-argonaut-only-v1');
    const listed = (LAPPER_ARGONAUT_FLAGS_SQL.match(/ARRAY\[([\s\S]*?)\]/)?.[1] ?? '').match(/\d+/g)?.map(Number);
    expect(listed).toEqual(FLAGGABLE_MACROS);
    expect(LAPPER_ARGONAUT_FLAGS_SQL).toContain('UPDATE lapper.macros SET flag_changes = (number = ANY(ARRAY[');
  });

  describe('when a macro is saved', () => {
    /** Runs the store's macro save against a fake manager; returns the values it wrote. */
    async function save(id: string | undefined, data: Record<string, unknown>, existingNumber?: number) {
      const written: Record<string, unknown>[] = [];
      const qb: Record<string, unknown> = {};
      for (const name of ['select', 'from', 'where', 'insert', 'into', 'update', 'setParameters']) qb[name] = () => qb;
      qb['values'] = (v: Record<string, unknown>) => (written.push(v), qb);
      qb['set'] = (v: Record<string, unknown>) => (written.push(v), qb);
      qb['getRawOne'] = async () => (existingNumber === undefined ? undefined : { id, number: existingNumber, min_value: null, max_value: null });
      qb['execute'] = async () => undefined;
      const manager = { createQueryBuilder: () => qb };
      const store = new PostgresLapperStore({} as never);
      await (store as unknown as { write(...args: unknown[]): Promise<string> }).write(manager, 'macro', id, data, false);
      return written[0];
    }
    const base = { name: 'x', type: 'real', l60_table: 'L60', status: 1 };

    it('keeps Flag changes on an Argonaut macro as sent', async () => {
      expect((await save(undefined, { ...base, number: 10039, flag_changes: true }))['flag_changes']).toBe(true);
      expect((await save(undefined, { ...base, number: 10039, flag_changes: false }))['flag_changes']).toBe(false);
    });
    it('stores every other macro, consec included, with Flag changes off', async () => {
      expect((await save(undefined, { ...base, number: 10041, flag_changes: true }))['flag_changes']).toBe(false);
      expect((await save(undefined, { ...base, number: 10032 }))['flag_changes']).toBe(false);
    });
    it('uses the saved number when an edit does not send one, and the new number when it does', async () => {
      const id = '00000000-0000-4000-8000-000000000001';
      expect((await save(id, { flag_changes: true }, 10041))['flag_changes']).toBe(false);
      expect((await save(id, { flag_changes: true }, 10039))['flag_changes']).toBe(true);
      expect((await save(id, { number: 10041 }, 10039))['flag_changes']).toBe(false);
    });
  });
});
