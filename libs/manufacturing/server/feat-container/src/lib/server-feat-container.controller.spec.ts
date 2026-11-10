import { ContainerOrmEntity } from '@gearapps/manufacturing/server/data-access';
import { ServerUtilMailerService } from '@gearapps/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@gearapps/manufacturing/server/util-mailer/testing';
import { mockRepoFactory } from '@gearapps/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ServerFeatContainerController } from './server-feat-container.controller';
import { ServerFeatContainerService } from './server-feat-container.service';

describe('ServerFeatContainerController', () => {
  let controller: ServerFeatContainerController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatContainerService,
        {
          provide: getRepositoryToken(ContainerOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: ServerUtilMailerService,
          useFactory: mockMailerFactory,
        },
      ],
      controllers: [ServerFeatContainerController],
    }).compile();

    controller = module.get(ServerFeatContainerController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
