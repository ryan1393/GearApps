import { Repository } from 'typeorm';

import { PartSummaryOrmEntity } from '@libs/server/data-access';
import { ServerUtilMailerService } from '@libs/server/util-mailer';
import { mockMailerFactory } from '@libs/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@libs/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatPartSummaryService } from './server-feat-part-summary.service';

describe('ServerFeatPartSummaryService', () => {
  let service: ServerFeatPartSummaryService;
  let repoMock: MockType<Repository<PartSummaryOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatPartSummaryService,
        {
          provide: getRepositoryToken(PartSummaryOrmEntity),
          useFactory: mockRepoFactory,
        },
        { provide: ServerUtilMailerService, useFactory: mockMailerFactory },
      ],
    }).compile();

    service = module.get(ServerFeatPartSummaryService);
    repoMock = module.get(getRepositoryToken(PartSummaryOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
