
import { ServerUtilMailerService } from '@gearapps/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@gearapps/manufacturing/server/util-mailer/testing';
import { mockRepoFactory } from '@gearapps/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerFeatLocationTrayService } from './server-feat-location-tray.service'
import { ServerFeatLocationTrayController } from './server-feat-location-tray.controller';
import { LocationTrayOrmEntity } from '@gearapps/manufacturing/server/data-access';

describe('ServerFeatLocationTrayController', () => {
  let controller: ServerFeatLocationTrayController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatLocationTrayService,
        {
          provide: getRepositoryToken(LocationTrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: ServerUtilMailerService,
          useFactory: mockMailerFactory,
        },
      ],
      controllers: [ServerFeatLocationTrayController],
    }).compile();

    controller = module.get(ServerFeatLocationTrayController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
