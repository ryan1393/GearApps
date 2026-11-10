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
