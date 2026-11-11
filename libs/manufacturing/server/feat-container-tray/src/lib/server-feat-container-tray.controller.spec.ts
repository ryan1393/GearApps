
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@meshforge/manufacturing/server/util-mailer/testing';
import { mockRepoFactory } from '@meshforge/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerFeatContainerTrayService } from './server-feat-container-tray.service'
import { ServerFeatContainerTrayController } from './server-feat-container-tray.controller';
import { ContainerTrayOrmEntity } from '@meshforge/manufacturing/server/data-access';

describe('ServerFeatContainerTrayController', () => {
  let controller: ServerFeatContainerTrayController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatContainerTrayService,
        {
          provide: getRepositoryToken(ContainerTrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: ServerUtilMailerService,
          useFactory: mockMailerFactory,
        },
      ],
      controllers: [ServerFeatContainerTrayController],
    }).compile();

    controller = module.get(ServerFeatContainerTrayController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
