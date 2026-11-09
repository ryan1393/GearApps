
import { ServerUtilMailerService } from '@libs/server/util-mailer';
import { mockMailerFactory } from '@libs/server/util-mailer/testing';
import { mockRepoFactory } from '@libs/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerFeatPartSummaryService } from './server-feat-part-summary.service';
import { ServerFeatPartSummaryController } from './server-feat-part-summary.controller';
import { PartSummaryOrmEntity } from '@libs/server/data-access';

describe('ServerFeatPartSummaryController', () => {
  let controller: ServerFeatPartSummaryController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatPartSummaryService,
        {
          provide: getRepositoryToken(PartSummaryOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: ServerUtilMailerService,
          useFactory: mockMailerFactory,
        },
      ],
      controllers: [ServerFeatPartSummaryController],
    }).compile();

    controller = module.get(ServerFeatPartSummaryController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
