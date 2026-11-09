import { Repository } from 'typeorm';

import {
  BladeOrmEntity,
  BladeHistoryOrmEntity,
} from '@libs/server/data-access';
import { mockRepoFactory, MockType } from '@libs/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatBladeService } from './server-feat-blade.service';

describe('ServerFeatBladeService', () => {
  let service: ServerFeatBladeService;
  let repoMock: MockType<Repository<BladeOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatBladeService,
        {
          provide: getRepositoryToken(BladeOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: getRepositoryToken(BladeHistoryOrmEntity),
          useFactory: mockRepoFactory,
        },
      ],
    }).compile();

    service = module.get(ServerFeatBladeService);
    repoMock = module.get(getRepositoryToken(BladeOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
