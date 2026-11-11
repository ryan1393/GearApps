import { Repository } from 'typeorm';

import { UserOrmEntity, DepartmentOrmEntity } from '@meshforge/manufacturing/server/data-access';
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@meshforge/manufacturing/server/util-mailer/testing';
import { mockRepoFactory, MockType } from '@meshforge/manufacturing/server/util-testing';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatUserService } from './server-feat-user.service';

describe('ServerFeatUserService', () => {
  let service: ServerFeatUserService;
  let repoMock: MockType<Repository<UserOrmEntity>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: { get: jest.fn() } },
        ServerFeatUserService,
        {
          provide: getRepositoryToken(UserOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: getRepositoryToken(DepartmentOrmEntity),
          useFactory: mockRepoFactory,
        },
        { provide: ServerUtilMailerService, useFactory: mockMailerFactory },
      ],
    }).compile();

    service = module.get(ServerFeatUserService);
    repoMock = module.get(getRepositoryToken(UserOrmEntity));
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
    expect(repoMock).toBeTruthy();
  });
});
