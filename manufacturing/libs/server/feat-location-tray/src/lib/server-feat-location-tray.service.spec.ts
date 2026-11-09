import { Repository } from 'typeorm';

import { ServerUtilMailerService } from '@libs/server/util-mailer';
import { mockMailerFactory } from '@libs/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@libs/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatLocationTrayService } from './server-feat-location-tray.service';
import { LocationTrayOrmEntity } from '@libs/server/data-access';

describe('ServerFeatLocationTrayService', () => {
  let service: ServerFeatLocationTrayService;
  let repoMock: MockType<Repository<LocationTrayOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatLocationTrayService,
        {
          provide: getRepositoryToken(LocationTrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        { provide: ServerUtilMailerService, useFactory: mockMailerFactory },
      ],
    }).compile();

    service = module.get(ServerFeatLocationTrayService);
    repoMock = module.get(getRepositoryToken(LocationTrayOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
