import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mailerConfig } from './mailer.config';

describe('manufacturing mail templates in the shared workspace', () => {
  let templateDir: string | undefined;
  let partialsDir: string | undefined;
  beforeEach(() => {
    templateDir = process.env['EMAIL_TEMPLATE_DIR'];
    partialsDir = process.env['EMAIL_PARTIALS_DIR'];
    delete process.env['EMAIL_TEMPLATE_DIR'];
    delete process.env['EMAIL_PARTIALS_DIR'];
  });
  afterEach(() => {
    if (templateDir === undefined) delete process.env['EMAIL_TEMPLATE_DIR'];
    else process.env['EMAIL_TEMPLATE_DIR'] = templateDir;
    if (partialsDir === undefined) delete process.env['EMAIL_PARTIALS_DIR'];
    else process.env['EMAIL_PARTIALS_DIR'] = partialsDir;
  });
  it('finds the recovery template and layout when started at repository root', () => {
    const config = mailerConfig();
    expect(existsSync(join(config.templateDir, 'reset-password.hbs'))).toBe(true);
    expect(existsSync(join(config.partialsDir, 'layout.hbs'))).toBe(true);
  });
  it('continues to find templates with the previous example environment paths', () => {
    process.env['EMAIL_TEMPLATE_DIR'] = 'manufacturing/apps/server/src/assets/templates';
    process.env['EMAIL_PARTIALS_DIR'] = 'manufacturing/apps/server/src/assets/templates/partials';
    const config = mailerConfig();
    expect(existsSync(join(config.templateDir, 'reset-password.hbs'))).toBe(true);
    expect(existsSync(join(config.partialsDir, 'layout.hbs'))).toBe(true);
  });
  it('preserves explicit Docker and custom template locations', () => {
    process.env['EMAIL_TEMPLATE_DIR'] = '/app/dist/apps/server/assets/templates';
    process.env['EMAIL_PARTIALS_DIR'] = 'custom/mail/partials';
    const config = mailerConfig();
    expect(config.templateDir).toBe('/app/dist/apps/server/assets/templates');
    expect(config.partialsDir).toBe('custom/mail/partials');
  });
});
