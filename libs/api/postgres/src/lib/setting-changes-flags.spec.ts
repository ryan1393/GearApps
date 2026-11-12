import { ARGONAUT_MACROS, FLAGGABLE_MACROS, macroCanFlagChanges } from '@meshforge/shared/domain';
import { PostgresLapperCatalog } from './catalog';

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
});
