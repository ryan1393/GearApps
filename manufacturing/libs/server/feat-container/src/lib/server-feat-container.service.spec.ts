import { Repository } from 'typeorm';

import { ContainerOrmEntity } from '@libs/server/data-access';
import { ServerUtilMailerService } from '@libs/server/util-mailer';
import { mockMailerFactory } from '@libs/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@libs/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatContainerService } from './server-feat-container.service';

describe('ServerFeatContainerService', () => {
  let service: ServerFeatContainerService;
  let repoMock: MockType<Repository<ContainerOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatContainerService,
        {
          provide: getRepositoryToken(ContainerOrmEntity),
          useFactory: mockRepoFactory,
        },
        { provide: ServerUtilMailerService, useFactory: mockMailerFactory },
      ],
    }).compile();

    service = module.get(ServerFeatContainerService);
    repoMock = module.get(getRepositoryToken(ContainerOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
