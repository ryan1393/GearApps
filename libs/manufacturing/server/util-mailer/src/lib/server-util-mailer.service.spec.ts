import { mailerConfig } from '@meshforge/manufacturing/server/util-common';
import { Test } from '@nestjs/testing';

import { mailTransportOptions, ServerUtilMailerService } from './server-util-mailer.service';

describe('ServerUtilMailerService', () => {
  let service: ServerUtilMailerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServerUtilMailerService,
        {
          provide: mailerConfig.KEY,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(ServerUtilMailerService);
  });

  it('should be defined', () => {
    expect(service).toBeTruthy();
  });

  it('logs the mail conversation only when EMAIL_DEBUG is true', () => {
    const base = { host: 'smtp', port: 587, ignoreTls: false, secure: false, requireTls: true, user: 'u', password: 'p' };
    expect(mailTransportOptions({ ...base, debug: false })).toMatchObject({ logger: false, debug: false });
    expect(mailTransportOptions({ ...base, debug: true })).toMatchObject({ logger: true, debug: true });
  });
});
