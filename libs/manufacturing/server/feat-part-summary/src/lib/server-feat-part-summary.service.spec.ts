import { Repository } from 'typeorm';

import { CreatePartSummaryDto, PartSummaryOrmEntity, UpdatePartSummaryDto } from '@meshforge/manufacturing/server/data-access';
import { plainToInstance } from 'class-transformer';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@meshforge/manufacturing/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@meshforge/manufacturing/server/util-testing';
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

  it('a partial update that omits revision leaves it alone; create still defaults it to blank', async () => {
    expect(plainToInstance(UpdatePartSummaryDto, { hos: 'LH' }).revision).toBeUndefined();
    expect(plainToInstance(CreatePartSummaryDto, { number: '1', active: true, enabled: true }).revision).toBeUndefined();
    (repoMock as unknown as { create: jest.Mock }).create = jest.fn((value: object) => ({ ...value, save: jest.fn() }));
    const created = await service.createPartSummary(plainToInstance(CreatePartSummaryDto, { number: '1', active: true, enabled: true }), 'u');
    expect(created.revision).toBe('');
  });
});
