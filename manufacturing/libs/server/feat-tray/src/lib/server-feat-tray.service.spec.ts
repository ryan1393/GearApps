import { Repository } from 'typeorm';

import {
  BladeTrayOrmEntity,
  CutterBladeRequirementOrmEntity,
  CutterPartTypeOrmEntity,
  PartSummaryOrmEntity,
  TrayOrmEntity,
} from '@gearapps/manufacturing/server/data-access';
import { mockRepoFactory, MockType } from '@gearapps/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatTrayService } from './server-feat-tray.service';

describe('ServerFeatTrayService', () => {
  let service: ServerFeatTrayService;
  let repoMock: MockType<Repository<TrayOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatTrayService,

        {
          provide: getRepositoryToken(TrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: getRepositoryToken(BladeTrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: getRepositoryToken(CutterBladeRequirementOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: getRepositoryToken(PartSummaryOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: getRepositoryToken(CutterPartTypeOrmEntity),
          useFactory: mockRepoFactory,
        },

      ],
    }).compile();

    service = module.get(ServerFeatTrayService);
    repoMock = module.get(getRepositoryToken(TrayOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
