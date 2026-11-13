import { ForbiddenException } from '@nestjs/common';
import { LapperReadSettingsController } from './lapper-read-settings.controller';

describe('Lapper Read Argonaut settings', () => {
  const settings = { url: 'https://argo/x', location_id: 'loc', username: 'user', password: 'pw', transaction_type_id: 100, verify_tls: false };
  const controller = new LapperReadSettingsController({ collectorSettings: () => ({ ...settings }) } as never);
  const user = (extra: object) => ({ id: 'u', email: 'e', role: 'user', ...extra }) as never;

  it('gives the sign-in, password included, to a collector token', () => {
    expect(controller.argonautSettings(user({ collectorTokenId: 't1' }))).toEqual(settings);
  });

  it('never sends the password to an administrator session, only whether one is set', () => {
    const shown = controller.argonautSettings(user({ role: 'admin' }));
    expect(shown).not.toHaveProperty('password');
    expect(JSON.stringify(shown)).not.toContain('"pw"');
    expect(shown).toEqual({ url: 'https://argo/x', location_id: 'loc', username: 'user', password_set: true, transaction_type_id: 100, verify_tls: false });
  });

  it('refuses everyone else', () => {
    expect(() => controller.argonautSettings(user({}))).toThrow(ForbiddenException);
    expect(() => controller.argonautSettings(undefined as never)).toThrow(ForbiddenException);
  });
});
