import { Repository } from 'typeorm';

import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@meshforge/manufacturing/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@meshforge/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatContainerTrayService } from './server-feat-container-tray.service';
import { ContainerTrayOrmEntity } from '@meshforge/manufacturing/server/data-access';

describe('ServerFeatContainerTrayService', () => {
  let service: ServerFeatContainerTrayService;
  let repoMock: MockType<Repository<ContainerTrayOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatContainerTrayService,
        {
          provide: getRepositoryToken(ContainerTrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        { provide: ServerUtilMailerService, useFactory: mockMailerFactory },
      ],
    }).compile();

    service = module.get(ServerFeatContainerTrayService);
    repoMock = module.get(getRepositoryToken(ContainerTrayOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
