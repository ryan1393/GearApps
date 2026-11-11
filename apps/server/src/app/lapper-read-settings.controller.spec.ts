import { ForbiddenException } from '@nestjs/common';
import { LapperReadSettingsController } from './lapper-read-settings.controller';

describe('Lapper Read Argonaut settings', () => {
  const settings = { url: 'https://argo/x', location_id: 'loc', username: 'user', password: 'pw', transaction_type_id: 100, verify_tls: false };
  const controller = new LapperReadSettingsController({ collectorSettings: () => settings } as never);
  const user = (extra: object) => ({ id: 'u', email: 'e', role: 'user', ...extra }) as never;

  it('gives the sign-in to a collector token and to administrators', () => {
    expect(controller.argonautSettings(user({ collectorTokenId: 't1' }))).toEqual(settings);
    expect(controller.argonautSettings(user({ role: 'admin' }))).toEqual(settings);
  });

  it('refuses everyone else, since it includes the Argonaut password', () => {
    expect(() => controller.argonautSettings(user({}))).toThrow(ForbiddenException);
    expect(() => controller.argonautSettings(undefined as never)).toThrow(ForbiddenException);
  });
});
