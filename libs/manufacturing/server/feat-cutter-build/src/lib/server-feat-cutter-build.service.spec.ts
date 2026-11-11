import { DataSource, EntityManager } from 'typeorm';

import { ServerFeatCutterBuildService } from './server-feat-cutter-build.service';

describe('ServerFeatCutterBuildService', () => {
  let service: ServerFeatCutterBuildService;

  beforeEach(() => {
    service = new ServerFeatCutterBuildService({} as DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
  });

  it('generates the first Ring build number per cutter body', async () => {
    const manager = {
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue(null),
      }),
    } as unknown as EntityManager;

    const result = await (
      service as unknown as {
        nextBuildNumber(
          manager: EntityManager,
          cutterBodyId: string,
          cutterBodySerial: string,
          partTypeCode: string,
          summaryNumber: string,
        ): Promise<{ buildNumber: string; buildIncrement: number }>;
      }
    ).nextBuildNumber(
      manager,
      '11111111-1111-1111-1111-111111111111',
      '1042',
      'RING',
      '12345',
    );

    expect(result).toEqual({
      buildNumber: 'R12345-1042-001',
      buildIncrement: 1,
    });
  });

  it('increments independently from the prior build for that body', async () => {
    const manager = {
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue({ build_increment: 7 }),
      }),
    } as unknown as EntityManager;

    const result = await (
      service as unknown as {
        nextBuildNumber(
          manager: EntityManager,
          cutterBodyId: string,
          cutterBodySerial: string,
          partTypeCode: string,
          summaryNumber: string,
        ): Promise<{ buildNumber: string; buildIncrement: number }>;
      }
    ).nextBuildNumber(
      manager,
      '11111111-1111-1111-1111-111111111111',
      'BODY-9',
      'PINION',
      '67890',
    );

    expect(result).toEqual({
      buildNumber: 'P67890-BODY9-008',
      buildIncrement: 8,
    });
  });
});

// Cutter-body identifier contract:
// getCutterBodyBySerial accepts Dana S/N or MF S/N. Dana remains canonical.
// Duplicate MF matches must raise ConflictException rather than choosing a body.

describe('Cutter body Dana S/N entry', () => {
  const definitions: Record<string, object> = {
    'def-076': { id: 'def-076', definition_code: 'CGRT076', cutter_head_code: 'C', supplier_code: 'G', hand_code: 'R', blade_family_code: 'T', size_code: '076', enabled: true },
  };
  const make = (existing: object | null = null) => {
    const bodyRepo = {
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => (where['id'] ? existing : null)),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
    };
    const definitionRepo = { findOne: jest.fn(async ({ where }: { where: { id: string } }) => definitions[where.id] ?? null) };
    const dataSource = {
      getRepository: jest.fn((entity: { name: string }) => (entity.name === 'CutterBodyDefinitionOrmEntity' ? definitionRepo : bodyRepo)),
    };
    return { service: new ServerFeatCutterBuildService(dataSource as never), bodyRepo };
  };

  it('creates an unetched body with only an MF serial and its definition', async () => {
    const { service } = make();
    await expect(service.createCutterBody({ mf_serial_number: ' a777 ', definition_id: 'def-076' }, 'u'))
      .resolves.toMatchObject({ mf_serial_number: 'A777', dana_serial_number: null, definition_id: 'def-076' });
  });

  it('refuses a malformed Dana S/N instead of storing it', async () => {
    const { service, bodyRepo } = make();
    await expect(service.createCutterBody({ mf_serial_number: 'A1', dana_serial_number: 'CGRT-1058A' }, 'u')).rejects.toThrow('letters and digits');
    expect(bodyRepo.save).not.toHaveBeenCalled();
  });

  it('refuses a Dana S/N that contradicts the linked definition', async () => {
    const { service } = make();
    await expect(service.createCutterBody({ mf_serial_number: 'A1', dana_serial_number: 'CGLT076AAZ', definition_id: 'def-076' }, 'u')).rejects.toThrow('hand');
  });

  it('assigns a Dana S/N later to the same body row (identity and history kept)', async () => {
    const body = { id: 'b1', mf_serial_number: 'A777', dana_serial_number: null, definition_id: 'def-076', definition: definitions['def-076'], enabled: true };
    const { service, bodyRepo } = make(body);
    await expect(service.assignCutterBodyDanaSerial('b1', { dana_serial_number: 'cgrt076zzz' }, 'u')).resolves.toMatchObject({ id: 'b1', mf_serial_number: 'A777', dana_serial_number: 'CGRT076ZZZ' });
    expect(bodyRepo.create).not.toHaveBeenCalled();
    await expect(service.assignCutterBodyDanaSerial('b1', { dana_serial_number: 'CGRT088ZZZ' }, 'u')).rejects.toThrow('body size');
  });

  it('leaves an unchanged legacy Dana S/N alone when other fields are edited', async () => {
    const body = { id: 'b2', mf_serial_number: 'X', dana_serial_number: 'OLD-SERIAL', definition_id: null, definition: null, enabled: true };
    const { service } = make(body);
    await expect(service.updateCutterBody('b2', { dana_serial_number: 'old-serial', description: 'note' }, 'u')).resolves.toMatchObject({ description: 'note', dana_serial_number: 'OLD-SERIAL' });
  });
});
