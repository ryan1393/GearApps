import {
  CutterBladeRequirementOrmEntity,
  CutterBuildTrayOrmEntity,
  CutterPartTypeOrmEntity,
  PartSummaryOrmEntity,
  TrayOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { BladeStatus } from '@meshforge/manufacturing/shared/util-types';
import { ServerFeatCutterConfigService } from './server-feat-cutter-config.service';

describe('ServerFeatCutterConfigService tray validation', () => {
  const requirement = {
    id: 'req-1',
    summary_id: 'summary-1',
    part_type_id: 'ring-1',
    required_blade_count: 24,
    enabled: true,
  } as CutterBladeRequirementOrmEntity;

  const createService = (overrides?: {
    tray?: Partial<TrayOrmEntity>;
    blades?: Array<{
      id: string;
      blade: {
        id: string;
        enabled: boolean;
        summary_id: string;
        part_type_id: string;
        status: BladeStatus;
      };
    }>;
    buildAssignment?: Partial<CutterBuildTrayOrmEntity> | null;
    containerAssignment?: object | null;
  }) => {
    const requirementRepo = {
      findOne: jest.fn().mockResolvedValue(requirement),
    };
    const partTypeRepo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ id: 'ring-1', enabled: true }),
    };
    const summaryRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'summary-1', enabled: true }),
    };
    const partRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOneOrFail: jest.fn(),
    };
    const rollMasterRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const trayRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'tray-1',
        serial_number: 'TRAY-1',
        summary_id: 'summary-1',
        part_type_id: 'ring-1',
        grinding_completed_at: new Date(),
        current_stage: { code: 'READY_FOR_CUTTER' },
        required_blade_count: 24,
        blade_count: 24,
        enabled: true,
        ...overrides?.tray,
      }),
    };
    const bladeTrayRepo = {
      find: jest.fn().mockResolvedValue(
        overrides?.blades ??
          Array.from({ length: 24 }, (_, i) => ({
            id: `assignment-${i}`,
            blade: {
              id: `blade-${i}`,
              enabled: true,
              summary_id: 'summary-1',
              part_type_id: 'ring-1',
              status: BladeStatus.RETURNED_FROM_COATING,
            },
          })),
      ),
    };
    const containerTrayRepo = {
      findOne: jest.fn().mockResolvedValue(
        overrides?.containerAssignment === undefined
          ? null
          : overrides.containerAssignment,
      ),
    };
    const cutterBuildTrayRepo = {
      findOne: jest.fn().mockResolvedValue(
        overrides?.buildAssignment === undefined
          ? null
          : overrides.buildAssignment,
      ),
    };

    return new ServerFeatCutterConfigService(
      requirementRepo as never,
      partTypeRepo as never,
      summaryRepo as never,
      partRepo as never,
      rollMasterRepo as never,
      trayRepo as never,
      bladeTrayRepo as never,
      cutterBuildTrayRepo as never,
      containerTrayRepo as never,
    );
  };

  it('accepts an exact post-grind tray with matching blade identity', async () => {
    const result = await createService().validateTray({
      summary_id: 'summary-1',
      part_type_id: 'ring-1',
      tray_serial_number: 'TRAY-1',
    });

    expect(result.valid).toBe(true);
  });

  it('rejects a tray before grinding is completed', async () => {
    const result = await createService({
      tray: { grinding_completed_at: null },
    }).validateTray({
      summary_id: 'summary-1',
      part_type_id: 'ring-1',
      tray_serial_number: 'TRAY-1',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Grinding has not been completed');
  });

  it('rejects a tray with the wrong blade identity even when count is correct', async () => {
    const blades = Array.from({ length: 24 }, (_, i) => ({
      id: `assignment-${i}`,
      blade: {
        id: `blade-${i}`,
        enabled: true,
        summary_id: i === 0 ? 'wrong-summary' : 'summary-1',
        part_type_id: 'ring-1',
        status: BladeStatus.RETURNED_FROM_COATING,
      },
    }));

    const result = await createService({ blades }).validateTray({
      summary_id: 'summary-1',
      part_type_id: 'ring-1',
      tray_serial_number: 'TRAY-1',
    });

    expect(result.valid).toBe(false);
    expect(result.blade_identity_matches).toBe(false);
  });


  it('rejects a tray whose blades have not returned from coating', async () => {
    const blades = Array.from({ length: 24 }, (_, i) => ({
      id: `assignment-${i}`,
      blade: {
        id: `blade-${i}`,
        enabled: true,
        summary_id: 'summary-1',
        part_type_id: 'ring-1',
        status: BladeStatus.READY_FOR_COATING,
      },
    }));

    const result = await createService({ blades }).validateTray({
      summary_id: 'summary-1',
      part_type_id: 'ring-1',
      tray_serial_number: 'TRAY-1',
    });

    expect(result.valid).toBe(false);
    expect(result.blades_ready_for_cutter).toBe(false);
  });

  it('rejects a tray that is still loaded in a Coater container', async () => {
    const result = await createService({
      containerAssignment: { id: 'container-tray-1' },
    }).validateTray({
      summary_id: 'summary-1',
      part_type_id: 'ring-1',
      tray_serial_number: 'TRAY-1',
    });

    expect(result.valid).toBe(false);
    expect(result.still_in_container).toBe(true);
  });

  it('rejects a tray already assigned to another active cutter build', async () => {
    const result = await createService({
      buildAssignment: { id: 'existing-build-tray' },
    }).validateTray({
      summary_id: 'summary-1',
      part_type_id: 'ring-1',
      tray_serial_number: 'TRAY-1',
    });

    expect(result.valid).toBe(false);
    expect(result.already_assigned_to_build).toBe(true);
  });
});

describe('ServerFeatCutterConfigService gearset part guards', () => {
  const types: Record<string, { id: string; code: string; enabled: boolean }> = {
    ring: { id: 'ring', code: 'RING', enabled: true },
    pinion: { id: 'pinion', code: 'PINION', enabled: true },
    gearset: { id: 'gearset', code: 'GEARSET', enabled: true },
  };
  const ringPart = {
    id: 'part-1',
    part_number: 'R100',
    summary_id: 'summary-1',
    part_type_id: 'ring',
    teeth: 41,
    active: true,
    enabled: true,
  };

  const createService = (inGearset: boolean) => {
    const query = jest.fn().mockResolvedValue(inGearset ? [{ '?column?': 1 }] : []);
    const partRepo = {
      findOne: jest.fn(async ({ where }: { where: { id?: string; part_number?: string } }) =>
        where.id === ringPart.id ? { ...ringPart } : null,
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOneOrFail: jest.fn(async () => ({ ...ringPart })),
      manager: { query },
    };
    const partTypeRepo = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => types[where.id] ?? null),
    };
    const summaryRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'summary-1', enabled: true }),
    };
    const service = new ServerFeatCutterConfigService(
      {} as never,
      partTypeRepo as never,
      summaryRepo as never,
      partRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, partRepo, query };
  };

  it('refuses to create a bare GEARSET-type part', async () => {
    const { service, partRepo } = createService(false);
    await expect(
      service.createPart(
        { part_number: 'GS1', summary_id: 'summary-1', part_type_id: 'gearset' },
        'user-1',
      ),
    ).rejects.toThrow('Use Admin > Gearsets');
    expect(partRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to change a part to the GEARSET type', async () => {
    const { service, partRepo } = createService(false);
    await expect(
      service.updatePart('part-1', { part_type_id: 'gearset' }, 'user-1'),
    ).rejects.toThrow('to or from the Gearset type');
    expect(partRepo.save).not.toHaveBeenCalled();
  });

  it('fixes identity fields of a part used by a gearset but allows status changes', async () => {
    const { service, partRepo, query } = createService(true);
    await expect(
      service.updatePart('part-1', { teeth: 43 }, 'user-1'),
    ).rejects.toThrow('belongs to a gearset');
    expect(query.mock.calls[0][1]).toEqual(['part-1']);
    expect(partRepo.save).not.toHaveBeenCalled();

    await service.updatePart('part-1', { active: false }, 'user-1');
    expect(partRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, teeth: 41 }),
    );
  });

  it('lets parts outside a gearset change summary and teeth', async () => {
    const { service, partRepo } = createService(false);
    await service.updatePart('part-1', { teeth: 43 }, 'user-1');
    expect(partRepo.save).toHaveBeenCalledWith(expect.objectContaining({ teeth: 43 }));
  });
});
