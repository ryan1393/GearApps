import {
  CutterBladeRequirementOrmEntity,
  CutterBuildTrayOrmEntity,
  CutterPartTypeOrmEntity,
  PartSummaryOrmEntity,
  TrayOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { BladeStatus } from '@meshforge/manufacturing/shared/util-types';
import { ServerFeatCutterConfigService, toSummaryBodyRuleRow } from './server-feat-cutter-config.service';

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
      manager: { query: jest.fn().mockResolvedValue([]) },
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

describe('ServerFeatCutterConfigService blade requirement quantities', () => {
  const service = () => {
    const transaction = jest.fn();
    const repo = { findOne: jest.fn().mockResolvedValue(null), manager: { transaction, query: jest.fn() } };
    const ok = { findOne: jest.fn().mockResolvedValue({ id: 'x', enabled: true }) };
    return { transaction, svc: new ServerFeatCutterConfigService(repo as never, ok as never, ok as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never) };
  };

  it.each([0, 12, 22, 26, 34, 38])('rejects %i: requirements are matched sets of an approved body rule', async (count) => {
    const { svc, transaction } = service();
    await expect(svc.createRequirement({ summary_id: 's', part_type_id: 'p', required_blade_count: count })).rejects.toThrow('matched inner/outer blade sets');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown Body Size Rule before touching data', async () => {
    const { svc, transaction } = service();
    await expect(svc.setSummaryBodyRule('s', '105-STANDARD', 'u')).rejects.toThrow('Body Size Rule must be one of');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('Summary body rule rows', () => {
  const row = (body_rule: string | null, counts: number[]) => toSummaryBodyRuleRow({
    summary_id: 's', summary_number: '30131', summary_revision: null, summary_enabled: true, model_number: '286', body_rule,
    requirements: counts.map((c, i) => ({ id: `r${i}`, part_type_code: i ? 'RING' : 'PINION', required_blade_count: c, enabled: true })),
  });

  it('keeps 076 and special 105 distinct although both are 26 blades', () => {
    expect(row('105-SPECIAL', [13, 13])).toMatchObject({ status: 'CONFIGURED', effective_body_rule: '105-SPECIAL', required_blade_sets: 13, required_total_blades: 26 });
    expect(row('076', [13, 13])).toMatchObject({ status: 'CONFIGURED', effective_body_rule: '076', required_total_blades: 26 });
    expect(row(null, [13, 13])).toMatchObject({ status: 'UNRESOLVED', effective_body_rule: null, required_total_blades: 26 });
  });

  it('derives 088 for 32209-style 17-set requirements without doubling', () => {
    expect(row(null, [17, 17])).toMatchObject({ status: 'DERIVED', effective_body_rule: '088', required_blade_sets: 17, required_total_blades: 34 });
  });

  it('reports RING/PINION disagreement instead of picking one', () => {
    expect(row(null, [19, 13])).toMatchObject({ status: 'CONFLICT', required_blade_sets: null });
  });
});

describe('Body-aware tray validation and the compatibility matrix', () => {
  const definition = (code: string, enabled = true) => ({
    definition_id: `def-${code}`, definition_code: code, cutter_head_code: 'C', supplier_code: 'G', hand_code: code.charAt(2),
    blade_family_code: 'T', blade_family_name: 'TRI-AC', size_code: code.slice(4), definition_enabled: enabled,
  });
  const bodyRow = (dana: string | null, mf: string, code: string | null, extra: object = {}) => ({
    id: `body-${dana ?? mf}`, dana_serial_number: dana, mf_serial_number: mf, enabled: true, open_build: false,
    ...(code ? definition(code) : { definition_id: null }), ...extra,
  });

  const createService = (opts: { sets: number; partType: string; rule: string | null; bodies: object[] }) => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('cutter_summary_body_rules')) return opts.rule ? [{ body_rule: opts.rule }] : [];
      if (sql.includes('FROM public.cutter_bodies')) return opts.bodies;
      return [];
    });
    const requirement = { id: 'req', summary_id: 's1', part_type_id: 'pt', required_blade_count: opts.sets, enabled: true, part_type: { code: opts.partType } };
    const tray = {
      id: 't1', serial_number: 'TRAY-1', summary_id: 's1', part_type_id: 'pt', grinding_completed_at: new Date(),
      current_stage: { code: 'READY_FOR_CUTTER' }, required_blade_count: opts.sets, blade_count: opts.sets, enabled: true,
    };
    const blades = Array.from({ length: opts.sets }, (_, i) => ({ blade: { id: `b${i}`, enabled: true, summary_id: 's1', part_type_id: 'pt', status: BladeStatus.RETURNED_FROM_COATING } }));
    const none = { findOne: jest.fn().mockResolvedValue(null) };
    return new ServerFeatCutterConfigService(
      { findOne: jest.fn().mockResolvedValue(requirement), manager: { query } } as never,
      {} as never, {} as never, {} as never, {} as never,
      { findOne: jest.fn().mockResolvedValue(tray) } as never,
      { find: jest.fn().mockResolvedValue(blades) } as never,
      none as never, none as never,
    );
  };
  const validate = (svc: ServerFeatCutterConfigService, body: string) =>
    svc.validateTray({ summary_id: 's1', part_type_id: 'pt', tray_serial_number: 'TRAY-1', cutter_body_identifier: body });

  it('accepts a permitted body for the Summary + Part Type', async () => {
    const svc = createService({ sets: 13, partType: 'PINION', rule: '076', bodies: [bodyRow('CGLT076AAA', '8612', 'CGLT076')] });
    await expect(validate(svc, 'cglt076aaa')).resolves.toMatchObject({ valid: true, body_compatible: true, body_rule: '076', body_available: true });
  });

  it('rejects a body whose capacity matches but whose rule does not (105 Special vs 076)', async () => {
    const svc = createService({ sets: 13, partType: 'RING', rule: '076', bodies: [bodyRow('CGRT1058AA', '78', 'CGRT105')] });
    const result = await validate(svc, 'CGRT1058AA');
    expect(result).toMatchObject({ valid: false, body_compatible: false, body_rule: '105-SPECIAL' });
    expect(result.reason).toContain('076 Standard');
  });

  it('accepts an unetched MF-only body through its linked non-105 definition', async () => {
    const svc = createService({ sets: 17, partType: 'RING', rule: null, bodies: [bodyRow(null, 'A777', 'CGRT088')] });
    await expect(validate(svc, 'A777')).resolves.toMatchObject({ valid: true, body_compatible: true, body_rule: '088' });
  });

  it('keeps compatibility apart from availability', async () => {
    const svc = createService({ sets: 19, partType: 'RING', rule: null, bodies: [bodyRow('CGRT105AAB', 'A1', 'CGRT105', { open_build: true })] });
    const result = await validate(svc, 'CGRT105AAB');
    expect(result).toMatchObject({ valid: false, body_compatible: true, body_available: false });
    expect(result.reason).toContain('open build');
  });

  it('refuses an ambiguous manufacturer serial instead of picking a body', async () => {
    const svc = createService({ sets: 13, partType: 'RING', rule: '076', bodies: [bodyRow('CGRT076AAA', '615', 'CGRT076'), bodyRow('CGRT076AAS', '615', 'CGRT076')] });
    const result = await validate(svc, '615');
    expect(result).toMatchObject({ valid: false, body_compatible: false });
    expect(result.body_reason).toContain('multiple cutter bodies');
  });

  it('serves the Summary + Part Type matrix from configured data', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM public.cutter_body_definitions')) {
        return ['CGRT076', 'CGLT076', 'CGRT105', 'CGLT105'].map((c) => ({ ...definition(c), id: `def-${c}`, enabled: true }));
      }
      return [
        { summary_id: 'a', summary_number: '30538', summary_revision: '', summary_enabled: true, model_number: null, hos: 'RH', body_rule: null,
          requirements: [{ part_type_code: 'PINION', required_blade_count: 19, enabled: true }, { part_type_code: 'RING', required_blade_count: 19, enabled: true }] },
        { summary_id: 'b', summary_number: '30131', summary_revision: '', summary_enabled: true, model_number: '286', hos: 'LH', body_rule: null,
          requirements: [{ part_type_code: 'RING', required_blade_count: '13', enabled: true }] },
      ];
    });
    const svc = new ServerFeatCutterConfigService({ manager: { query } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const rows = await svc.listBodyCompatibilityMatrix(null);
    expect(rows.map((r) => [r.summary_number, r.part_type_code, r.body_rule, r.required_total_blades, r.evidence, r.permitted_definitions.map((d) => d.definition_code).join(',')])).toEqual([
      ['30538', 'PINION', '105', 38, 'SUPPORTED', 'CGLT105,CGRT105'],
      ['30538', 'RING', '105', 38, 'SUPPORTED', 'CGLT105,CGRT105'],
      ['30131', 'RING', null, 26, 'UNRESOLVED', ''],
    ]);
  });
});
