import { LocationOrmEntity, PartSummaryOrmEntity } from '@libs/server/data-access';
import { ServerUtilMailerService } from '@libs/server/util-mailer';
import { mockMailerFactory } from '@libs/server/util-mailer/testing';
import { mockRepoFactory } from '@libs/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatLocationController } from './server-feat-location.controller';
import { ServerFeatLocationService } from './server-feat-location.service';

describe('ServerFeatLocationController', () => {
  let controller: ServerFeatLocationController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatLocationService,
        {
          provide: getRepositoryToken(LocationOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: getRepositoryToken(PartSummaryOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: ServerUtilMailerService,
          useFactory: mockMailerFactory,
        },
      ],
      controllers: [ServerFeatLocationController],
    }).compile();

    controller = module.get(ServerFeatLocationController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
