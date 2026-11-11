
import { ServerUtilMailerService } from '@meshforge/manufacturing/server/util-mailer';
import { mockMailerFactory } from '@meshforge/manufacturing/server/util-mailer/testing';
import { mockRepoFactory } from '@meshforge/manufacturing/server/util-testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerFeatBladeTrayService } from './server-feat-blade-tray.service';
import { ServerFeatBladeTrayController } from './server-feat-blade-tray.controller';
import { BladeTrayOrmEntity } from '@meshforge/manufacturing/server/data-access';

describe('ServerFeatBladeTrayController', () => {
  let controller: ServerFeatBladeTrayController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerFeatBladeTrayService,
        {
          provide: getRepositoryToken(BladeTrayOrmEntity),
          useFactory: mockRepoFactory,
        },
        {
          provide: ServerUtilMailerService,
          useFactory: mockMailerFactory,
        },
      ],
      controllers: [ServerFeatBladeTrayController],
    }).compile();

    controller = module.get(ServerFeatBladeTrayController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
