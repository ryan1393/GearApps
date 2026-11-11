import { UnprocessableEntityException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { BulkCreateShelfLocationsDto, LocationOrmEntity, PartSummaryOrmEntity } from '@meshforge/manufacturing/server/data-access';
import { Uuid } from '@meshforge/manufacturing/shared/util-types';

import { ServerFeatLocationService } from './server-feat-location.service';

type Row = Record<string, unknown> & { id: string; serial_number: string; enabled: boolean };

/** Just enough of a repository to run the bulk insert: a table with a unique barcode. */
function fakeLocations(existing: Row[] = []) {
  const table = new Map<string, Row>(existing.map((row) => [row.serial_number, row]));
  let next = 1;
  const inSerials = (where: { serial_number: { value: string[] } }) =>
    where.serial_number.value.flatMap((serial) => (table.has(serial) ? [table.get(serial) as Row] : []));
  const repo = {
    find: jest.fn(async ({ where }) => inSerials(where)),
    createQueryBuilder: () => {
      let rows: Row[] = [];
      const chain = {
        insert: () => chain,
        into: () => chain,
        values: (values: Row[]) => { rows = values; return chain; },
        orIgnore: () => chain,
        execute: async () => {
          for (const row of rows) if (!table.has(row.serial_number)) table.set(row.serial_number, { ...row, id: `new-${next++}` });
        },
      };
      return chain;
    },
  };
  interface FakeManager { getRepository(): typeof repo; transaction<T>(work: (m: FakeManager) => Promise<T>): Promise<T> }
  const manager: FakeManager = {
    getRepository: () => repo,
    transaction: async (work) => work(manager),
  };
  return { table, service: new ServerFeatLocationService(
    { manager } as unknown as Repository<LocationOrmEntity>,
    {} as Repository<PartSummaryOrmEntity>,
  ) };
}

const dto = (overrides: Partial<BulkCreateShelfLocationsDto> = {}): BulkCreateShelfLocationsDto =>
  Object.assign(new BulkCreateShelfLocationsDto(), { prefix: 'CGDR', shelf: 'a', layers: [1], bins: 3, ...overrides });
const user = '00000000-0000-4000-8000-000000000001' as Uuid;

describe('ServerFeatLocationService.bulkCreateShelfLocations', () => {
  it('makes every bin of the chosen layers as Cuttergrind shelves', async () => {
    const { service, table } = fakeLocations();
    const result = await service.bulkCreateShelfLocations(dto({ prefix: 'CGFP', layers: [2, 1], bins: 2 }), user);

    expect(result.locations.map(({ serial_number }) => serial_number)).toEqual(['CGFP-A1A', 'CGFP-A1B', 'CGFP-A2A', 'CGFP-A2B']);
    expect(result).toMatchObject({ created: 4, existing: 0 });
    expect(table.get('CGFP-A2B')).toMatchObject({
      number: 'A2B', department: 'CUTTERGRIND', location_type: 'SHELF', enabled: true, createdBy: user,
      description: 'Cuttergrind finished pinion shelf, shelf A, layer 2, bin B',
    });
  });

  it('leaves barcodes that already exist as they are', async () => {
    const old = { id: 'old-1', serial_number: 'CGDR-A1B', enabled: false, description: 'kept' };
    const { service, table } = fakeLocations([old]);
    const result = await service.bulkCreateShelfLocations(dto(), user);

    expect(result).toMatchObject({ created: 2, existing: 1 });
    expect(result.locations[1]).toEqual({ id: 'old-1', serial_number: 'CGDR-A1B', state: 'existing', enabled: false });
    expect(table.get('CGDR-A1B')).toBe(old);
  });

  it('refuses a layer or bin count out of range without writing', async () => {
    const { service, table } = fakeLocations();
    await expect(service.bulkCreateShelfLocations(dto({ layers: [10] }), user)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.bulkCreateShelfLocations(dto({ bins: 27 }), user)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.bulkCreateShelfLocations(dto({ shelf: 'AB' }), user)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(table.size).toBe(0);
  });
});
