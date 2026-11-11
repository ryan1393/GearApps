import { mockRepoFactory } from '@meshforge/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BladeOrmEntity,
  BladeHistoryOrmEntity,
} from '@meshforge/manufacturing/server/data-access';

import { ServerFeatBladeService } from './server-feat-blade.service';
import { ServerFeatBladeController } from './server-feat-blade.controller';

describe('ServerFeatBladeController', () => {
  let controller: ServerFeatBladeController;

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
      controllers: [ServerFeatBladeController],
    }).compile();

    controller = module.get(ServerFeatBladeController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
