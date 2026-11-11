import {
  CutterBladeRequirementOrmEntity,
  CutterPartTypeOrmEntity,
  LocationOrmEntity,
  PartSummaryOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { UnprocessableEntityException } from '@nestjs/common';

import { ServerFeatLocationService } from './server-feat-location.service';

const USER = '99999999-9999-4999-8999-999999999999';
const SUMMARY = { id: '11111111-1111-4111-8111-111111111111', number: '1.955FC', enabled: true };
const OLD_SUMMARY = { id: '22222222-2222-4222-8222-222222222222', number: '2.100FC', enabled: true };
const RING = { id: '33333333-3333-4333-8333-333333333333', code: 'RING', enabled: true };
const PINION = { id: '44444444-4444-4444-8444-444444444444', code: 'PINION', enabled: true };

/** A stand-in for the database: enabled summaries and part types, and the saved locations. */
function setup(existing: Partial<LocationOrmEntity> | null = null) {
  const saved: Array<Record<string, unknown>> = [];
  const summaries = [SUMMARY, OLD_SUMMARY];
  const partTypes = [RING, PINION];
  const matches = <T extends { id: string; enabled: boolean }>(rows: T[], where: Record<string, unknown>) =>
    rows.filter((row) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value));

  const locationRepo = {
    findOne: jest.fn(async () => null),
    findOneOrFail: jest.fn(async () => ({ ...existing, ...saved[saved.length - 1] })),
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => {
      saved.push(row);
      return { id: 'new-location', ...row };
    }),
  };
  const repositories = new Map<unknown, unknown>([
    [LocationOrmEntity, { ...locationRepo, findOneOrFail: jest.fn(async () => ({ id: 'location', ...existing, ...saved[saved.length - 1] })) }],
    [PartSummaryOrmEntity, {
      exists: jest.fn(async ({ where }) => matches(summaries, where).length > 0),
      find: jest.fn(async ({ where }) => matches(summaries, where)),
    }],
    [CutterPartTypeOrmEntity, {
      exists: jest.fn(async ({ where }) => matches(partTypes, where).length > 0),
      findOne: jest.fn(async ({ where }) => matches(partTypes, where)[0] ?? null),
    }],
    [CutterBladeRequirementOrmEntity, {
      createQueryBuilder: () => {
        const qb = { innerJoin: () => qb, where: () => qb, andWhere: () => qb, getCount: async () => 1 };
        return qb;
      },
    }],
  ]);
  interface FakeManager { getRepository(entity: unknown): unknown; transaction(work: (m: FakeManager) => unknown): Promise<unknown> }
  const manager: FakeManager = {
    getRepository: (entity) => repositories.get(entity),
    transaction: async (work) => work(manager),
  };
  Object.assign(locationRepo, { manager });
  (repositories.get(LocationOrmEntity) as Record<string, unknown>)['manager'] = manager;
  const partSummaryRepo = repositories.get(PartSummaryOrmEntity);

  const service = new ServerFeatLocationService(locationRepo as never, partSummaryRepo as never);
  return { service, saved };
}

const shelf = { serial_number: 'RACK-A-03', number: 'A-03', description: null, department: null, location_type: 'SHELF', enabled: true };

describe('location Summary and part type', () => {
  it('saves the chosen Summary and part type on a new location', async () => {
    const { service, saved } = setup();
    await service.createLocation({ ...shelf, summary_id: SUMMARY.id, part_type_id: RING.id }, USER);

    expect(saved[0]).toMatchObject({ serial_number: 'RACK-A-03', summary_id: SUMMARY.id, part_type_id: RING.id });
  });

  it('leaves both blank when none is chosen', async () => {
    const { service, saved } = setup();
    await service.createLocation(shelf, USER);

    expect(saved[0]['summary_id']).toBeUndefined();
    expect(saved[0]['part_type_id']).toBeUndefined();
  });

  it('refuses a Summary or part type that does not exist or is disabled', async () => {
    const { service, saved } = setup();

    await expect(service.createLocation({ ...shelf, summary_id: '55555555-5555-4555-8555-555555555555' }, USER)).rejects.toThrow(UnprocessableEntityException);
    await expect(service.createLocation({ ...shelf, part_type_id: '55555555-5555-4555-8555-555555555555' }, USER)).rejects.toThrow('part type');
    expect(saved).toHaveLength(0);
  });

  it('takes them from a Green Shed summary shelf barcode, whatever was chosen', async () => {
    const { service, saved } = setup();
    await service.createLocation(
      { serial_number: 'gsp-1.955fc', number: '', description: null, department: null, location_type: 'SHELF', enabled: true, summary_id: OLD_SUMMARY.id, part_type_id: RING.id },
      USER,
    );

    expect(saved[0]).toMatchObject({ serial_number: 'GSP-1.955FC', summary_id: SUMMARY.id, part_type_id: PINION.id });
  });

  it('takes the part type from the R or P in a Cuttergrind shelf barcode, whatever was chosen', async () => {
    const dull = setup();
    await dull.service.createLocation(
      { serial_number: 'cgdp-a1a', number: '', description: null, department: null, location_type: 'SHELF', enabled: true, summary_id: SUMMARY.id, part_type_id: RING.id },
      USER,
    );
    expect(dull.saved[0]).toMatchObject({ serial_number: 'CGDP-A1A', summary_id: SUMMARY.id, part_type_id: PINION.id });

    const finished = setup();
    await finished.service.createLocation(
      { serial_number: 'CGFR-B2C', number: '', description: null, department: null, location_type: 'SHELF', enabled: true, summary_id: SUMMARY.id },
      USER,
    );
    expect(finished.saved[0]).toMatchObject({ summary_id: SUMMARY.id, part_type_id: RING.id });

    const rough = setup();
    await rough.service.createLocation(
      { serial_number: 'CGRP-A1A', number: '', description: null, department: null, location_type: 'SHELF', enabled: true, part_type_id: null },
      USER,
    );
    expect(rough.saved[0]).toMatchObject({ part_type_id: PINION.id });
  });

  it('corrects a shelf\'s part type to its barcode on any edit, and refuses to clear it', async () => {
    const existing = { id: 'location', serial_number: 'CGDR-A1A', number: 'A1A', department: 'CUTTERGRIND', location_type: 'SHELF', enabled: true, summary_id: SUMMARY.id, part_type_id: PINION.id };

    const edited = setup(existing);
    await edited.service.updateLocation('location' as never, { description: 'Top shelf' }, USER as never);
    expect(edited.saved[0]['part_type_id']).toBe(RING.id);

    const cleared = setup(existing);
    await cleared.service.updateLocation('location' as never, { part_type_id: null, summary_id: OLD_SUMMARY.id }, USER as never);
    expect(cleared.saved[0]).toMatchObject({ summary_id: OLD_SUMMARY.id, part_type_id: RING.id });
  });

  it('changes, clears or keeps them on an existing location', async () => {
    const existing = { id: 'location', serial_number: 'RACK-A-03', number: 'A-03', department: null, location_type: 'SHELF', enabled: true, summary_id: OLD_SUMMARY.id, part_type_id: RING.id };

    const changed = setup(existing);
    await changed.service.updateLocation('location' as never, { summary_id: SUMMARY.id }, USER as never);
    expect(changed.saved[0]['summary_id']).toBe(SUMMARY.id);
    expect(changed.saved[0]['part_type_id']).toBeUndefined();

    const cleared = setup(existing);
    await cleared.service.updateLocation('location' as never, { summary_id: null, part_type_id: null }, USER as never);
    expect(cleared.saved[0]).toMatchObject({ summary_id: null, part_type_id: null });

    const kept = setup(existing);
    await kept.service.updateLocation('location' as never, { description: 'Top shelf' }, USER as never);
    expect(kept.saved[0]['summary_id']).toBeUndefined();
    expect(kept.saved[0]['part_type_id']).toBeUndefined();
  });
});
