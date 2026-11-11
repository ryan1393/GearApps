import {
  BladeHistoryOrmEntity, BladeOrmEntity, BladeTrayOrmEntity, ContainerTrayOrmEntity, CutterBladeRequirementOrmEntity,
  CutterBuildTrayOrmEntity, CutterPartTypeOrmEntity, LocationOrmEntity, LocationTrayOrmEntity, PartSummaryOrmEntity,
  TrayOrmEntity, TrayStageOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { BladeStatus, Uuid } from '@meshforge/manufacturing/shared/util-types';
import { DataSource } from 'typeorm';
import { OpeningInventoryDto, OpeningInventoryService } from './opening-inventory.service';

const SUMMARY = '11111111-1111-4111-8111-111111111111';
const RING = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333' as Uuid;

interface World {
  tray?: Record<string, unknown> | null;
  stageCode?: string;
  assigned?: number;
  inContainer?: boolean;
  shelf?: Record<string, unknown> | null;
  required?: number | null;
}

function setup(world: World = {}) {
  const tray = world.tray === undefined
    ? { id: 'tray-1', serial_number: 'T0001', enabled: true, blade_count: 0, current_stage_id: 'stage-empty' }
    : world.tray;
  const saved = { blades: [] as unknown[], assignments: [] as unknown[], history: [] as unknown[], placements: [] as unknown[], trays: [] as unknown[] };
  let bladeNumber = 0;
  const repositories = new Map<unknown, Record<string, unknown>>([
    [TrayOrmEntity, { findOne: async () => tray, save: async (value: unknown) => { saved.trays.push({ ...(value as object) }); return value; } }],
    [TrayStageOrmEntity, { findOne: async ({ where }: { where: { id?: string; code?: string } }) =>
      where.id ? { id: where.id, code: world.stageCode ?? 'EMPTY' } : { id: 'stage-' + where.code, code: where.code, name: where.code } }],
    [ContainerTrayOrmEntity, { findOne: async () => (world.inContainer ? { id: 'ct' } : null) }],
    [CutterBuildTrayOrmEntity, { findOne: async () => null }],
    [BladeTrayOrmEntity, { count: async () => world.assigned ?? 0, create: (value: unknown) => value,
      save: async (value: unknown) => { saved.assignments.push(value); return value; } }],
    [PartSummaryOrmEntity, { findOne: async () => ({ id: SUMMARY, number: '1010' }) }],
    [CutterPartTypeOrmEntity, { findOne: async () => ({ id: RING, code: 'RING' }) }],
    [CutterBladeRequirementOrmEntity, { findOne: async () => (world.required === null ? null : { required_blade_count: world.required ?? 17 }) }],
    [LocationOrmEntity, { findOne: async ({ where }: { where: { serial_number: string } }) => world.shelf === undefined
      ? { id: 'shelf-1', serial_number: where.serial_number, location_type: 'SHELF', department: 'CUTTERGRIND' } : world.shelf }],
    [BladeOrmEntity, { create: (value: unknown) => value,
      save: async (value: Record<string, unknown>) => { const blade = { ...value, id: 'blade-' + ++bladeNumber }; saved.blades.push(blade); return blade; } }],
    [BladeHistoryOrmEntity, { create: (value: unknown) => value, save: async (values: unknown[]) => { saved.history.push(...values); return values; } }],
    [LocationTrayOrmEntity, { update: async () => undefined, create: (value: unknown) => value,
      save: async (value: unknown) => { saved.placements.push(value); return value; } }],
  ]);
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: jest.fn(async () => []),
    getRepository: (entity: unknown) => repositories.get(entity),
  };
  const source = { transaction: (work: (m: unknown) => unknown) => work(manager) } as unknown as DataSource;
  return { service: new OpeningInventoryService(source), saved };
}

const dto = (changes: Partial<OpeningInventoryDto> = {}): OpeningInventoryDto => ({
  tray_serial_number: ' t0001 ', summary_id: SUMMARY, part_type_id: RING, stage: 'READY_FOR_COATING', shelf_serial_number: 'cgrr-001', ...changes,
});

describe('Opening inventory', () => {
  it('records a ground tray exactly as completing grinding leaves it', async () => {
    const { service, saved } = setup();
    const result = await service.record(dto({ service_cycle: 2 }), USER);
    expect(result).toMatchObject({ tray_serial_number: 'T0001', stage_code: 'READY_FOR_COATING', shelf_serial_number: 'CGRR-001', blade_count: 17 });
    expect(saved.blades).toHaveLength(17);
    expect(saved.blades[0]).toMatchObject({ status: BladeStatus.READY_FOR_COATING, summary_id: SUMMARY, part_type_id: RING, service_cycle: 2 });
    expect(saved.assignments).toHaveLength(17);
    expect(saved.history).toHaveLength(34);
    expect(saved.trays[0]).toMatchObject({ blade_count: 17, required_blade_count: 17, current_stage_id: 'stage-READY_FOR_COATING', summary_id: SUMMARY });
    expect((saved.trays[0] as { grinding_completed_at: Date }).grinding_completed_at).toBeInstanceOf(Date);
    expect(saved.placements).toEqual([expect.objectContaining({ tray_id: 'tray-1', location_id: 'shelf-1', enabled: true })]);
  });

  it('records a coated tray as returned from coating on a finished shelf', async () => {
    const { service, saved } = setup();
    await service.record(dto({ stage: 'READY_FOR_CUTTER', shelf_serial_number: 'CGFR-012' }), USER);
    expect(saved.blades[0]).toMatchObject({ status: BladeStatus.RETURNED_FROM_COATING });
    expect(saved.trays[0]).toMatchObject({ current_stage_id: 'stage-READY_FOR_CUTTER' });
  });

  it('only accepts the shelf the workflow would use for that stage and part type', async () => {
    for (const shelf of ['CGFR-001', 'CGRP-001', 'CGRR-1', 'SHELF-A']) {
      await expect(setup().service.record(dto({ shelf_serial_number: shelf }), USER)).rejects.toThrow('numbered CGRR-### shelf');
    }
    await expect(setup().service.record(dto({ stage: 'READY_FOR_CUTTER', shelf_serial_number: 'CGDR-A1A' }), USER))
      .rejects.toThrow('numbered CGFR-### shelf');
    await expect(setup({ shelf: null }).service.record(dto(), USER)).rejects.toThrow('missing, disabled, or not set up as a shelf');
  });

  it('refuses a tray that is missing, in use or not empty, and writes nothing', async () => {
    for (const world of [{ tray: null }, { assigned: 3 }, { inContainer: true }, { stageCode: 'GRINDING' },
      { tray: { id: 't', serial_number: 'T0001', enabled: true, blade_count: 5, current_stage_id: 's' } }] as World[]) {
      const { service, saved } = setup(world);
      await expect(service.record(dto(), USER)).rejects.toThrow(world.tray === null ? 'was not found' : 'already has contents or is in use');
      expect(saved.blades).toHaveLength(0);
    }
  });

  it('needs the blade quantity the Summary requires', async () => {
    await expect(setup({ required: null }).service.record(dto(), USER)).rejects.toThrow('No enabled blade quantity requirement');
  });
});
