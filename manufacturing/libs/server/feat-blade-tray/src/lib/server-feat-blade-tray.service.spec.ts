import { Repository } from 'typeorm';

import { ServerUtilMailerService } from '@libs/server/util-mailer';
import { mockMailerFactory } from '@libs/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@libs/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatBladeTrayService } from './server-feat-blade-tray.service';
import { BladeTrayOrmEntity } from '@libs/server/data-access';

describe('ServerFeatBladeTrayService', () => {
  let service: ServerFeatBladeTrayService;
  let repoMock: MockType<Repository<BladeTrayOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatBladeTrayService,
        {
          provide: getRepositoryToken(BladeTrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        { provide: ServerUtilMailerService, useFactory: mockMailerFactory },
      ],
    }).compile();

    service = module.get(ServerFeatBladeTrayService);
    repoMock = module.get(getRepositoryToken(BladeTrayOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
