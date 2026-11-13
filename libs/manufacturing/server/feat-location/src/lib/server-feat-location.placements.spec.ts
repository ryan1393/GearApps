import { ConflictException } from '@nestjs/common';
import { LocationOrmEntity } from '@meshforge/manufacturing/server/data-access';

import { ServerFeatLocationService } from './server-feat-location.service';

const LOCATION = '11111111-1111-4111-8111-111111111111';
const USER = '99999999-9999-4999-8999-999999999999';

/** A location with no trays, cutters or cutter bodies, and the given packed container sets. */
function setup(containerSets: Array<{ id: string }>) {
  const save = jest.fn(async (row: unknown) => row);
  const query = jest.fn<Promise<Array<{ id: string }>>, [string, unknown[]]>(
    async (sql) => (/container_sets/.test(sql) ? containerSets : []),
  );
  const manager = {
    query,
    getRepository: (entity: unknown) =>
      entity === LocationOrmEntity
        ? { findOne: async () => ({ id: LOCATION, enabled: true }), save }
        : { count: async () => 0 },
    transaction: async (work: (m: unknown) => unknown) => work(manager),
  };
  const service = new ServerFeatLocationService({ manager } as never, {} as never);
  return { service, save, query };
}

describe('location placements guard', () => {
  it('refuses disabling a location that holds a packed coater container', async () => {
    const { service, save, query } = setup([{ id: 'set' }]);
    const error = await service.deleteLocation(LOCATION as never, USER as never).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toContain('1 packed container(s)');
    expect(save).not.toHaveBeenCalled();
    const setQuery = query.mock.calls.find(([sql]) => /container_sets/.test(sql));
    expect(setQuery?.[1]).toEqual([LOCATION]);
  });

  it('disables an empty location', async () => {
    const { service, save } = setup([]);
    await service.deleteLocation(LOCATION as never, USER as never);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
