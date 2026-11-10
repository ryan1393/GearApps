import { UserOrmEntity, DepartmentOrmEntity } from '@gearapps/manufacturing/server/data-access';
import { ServerUtilMailerService } from '@gearapps/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@gearapps/manufacturing/server/util-mailer/testing';
import { mockRepoFactory } from '@gearapps/manufacturing/server/util-testing';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatUserController } from './server-feat-user.controller';
import { ServerFeatUserService } from './server-feat-user.service';

describe('ServerFeatUserController', () => {
  let controller: ServerFeatUserController;

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
        {
          provide: ServerUtilMailerService,
          useFactory: mockMailerFactory,
        },
      ],
      controllers: [ServerFeatUserController],
    }).compile();

    controller = module.get(ServerFeatUserController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
