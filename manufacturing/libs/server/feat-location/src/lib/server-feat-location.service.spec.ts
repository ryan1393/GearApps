import { Repository } from 'typeorm';

import { LocationOrmEntity, PartSummaryOrmEntity } from '@gearapps/manufacturing/server/data-access';
import { ServerUtilMailerService } from '@gearapps/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@gearapps/manufacturing/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@gearapps/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatLocationService } from './server-feat-location.service';

describe('ServerFeatLocationService', () => {
  let service: ServerFeatLocationService;
  let repoMock: MockType<Repository<LocationOrmEntity>>;

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
        { provide: ServerUtilMailerService, useFactory: mockMailerFactory },
      ],
    }).compile();

    service = module.get(ServerFeatLocationService);
    repoMock = module.get(getRepositoryToken(LocationOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
