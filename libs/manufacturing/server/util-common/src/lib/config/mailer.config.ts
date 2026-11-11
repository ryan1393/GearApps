import {
  ENV_EMAIL_DEBUG,
  ENV_EMAIL_DEFAULT_EMAIL,
  ENV_EMAIL_DEFAULT_NAME,
  ENV_EMAIL_ENABLED,
  ENV_EMAIL_HOST,
  ENV_EMAIL_IGNORE_TLS,
  ENV_EMAIL_PARTIALS_DIR,
  ENV_EMAIL_PASSWORD,
  ENV_EMAIL_PORT,
  ENV_EMAIL_REQUIRE_TLS,
  ENV_EMAIL_SECURE,
  ENV_EMAIL_TEMPLATE_DIR,
  ENV_EMAIL_USER,
} from '@meshforge/manufacturing/shared/util-constants';
import { registerAs } from '@nestjs/config';

import { CONFIG_NAMESPACE_MAILER } from '../constants';

export interface IMailerConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  templateDir: string;
  ignoreTls: boolean;
  requireTls: boolean;
  secure: boolean;
  debug: boolean;
  defaultName: string;
  defaultEmail: string;
  partialsDir: string;
}

// Local commands run from the unified repository root. Preserve explicitly
// configured absolute/custom paths and adapt the former workspace-relative path.
const templateDirectory = (configured: string | undefined, suffix = '') =>
  configured
    ? configured.replace(/^(?:manufacturing[\\/])?apps[\\/]server[\\/]/, 'apps/server/')
    : `apps/server/src/assets/templates${suffix}`;

export const mailerConfig = registerAs(CONFIG_NAMESPACE_MAILER, () => ({
  enabled: process.env[ENV_EMAIL_ENABLED] === 'true',
  host: process.env[ENV_EMAIL_HOST] ?? '',
  port: process.env[ENV_EMAIL_PORT]
    ? parseInt(process.env[ENV_EMAIL_PORT])
    : 587,
  user: process.env[ENV_EMAIL_USER] ?? '',
  password: process.env[ENV_EMAIL_PASSWORD] ?? '',
  templateDir: templateDirectory(process.env[ENV_EMAIL_TEMPLATE_DIR]),
  // ignoreTls: !!process.env[ENV_EMAIL_IGNORE_TLS] ?? false,
  // secure: !!process.env[ENV_EMAIL_SECURE] ?? true,
  // requireTls: !!process.env[ENV_EMAIL_REQUIRE_TLS] ?? true,
  // debug: !!process.env[ENV_EMAIL_DEBUG] ?? false,
  defaultName: process.env[ENV_EMAIL_DEFAULT_NAME] ?? '',
  defaultEmail: process.env[ENV_EMAIL_DEFAULT_EMAIL] ?? '',
  partialsDir: templateDirectory(process.env[ENV_EMAIL_PARTIALS_DIR], '/partials'),
  
  ignoreTls: process.env[ENV_EMAIL_IGNORE_TLS] === 'true',
  secure: process.env[ENV_EMAIL_SECURE] !== 'false',
  requireTls: process.env[ENV_EMAIL_REQUIRE_TLS] !== 'false',
  debug: process.env[ENV_EMAIL_DEBUG] === 'true',

}));
