import {
  BladeTrayOrmEntity,
  CutterBladeRequirementOrmEntity,
  CutterPartTypeOrmEntity,
  PartSummaryOrmEntity,
  TrayOrmEntity,
} from '@meshforge/manufacturing/server/data-access';
import { mockRepoFactory } from '@meshforge/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatTrayController } from './server-feat-tray.controller';
import { ServerFeatTrayService } from './server-feat-tray.service';

describe('ServerFeatTrayController', () => {
  let controller: ServerFeatTrayController;

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
      controllers: [ServerFeatTrayController],
    }).compile();

    controller = module.get(ServerFeatTrayController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
